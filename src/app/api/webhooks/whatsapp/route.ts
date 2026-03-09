/**
 * Webhook para receber mensagens da API WhatsApp (VPS).
 * Valida assinatura, persiste mensagem e dispara o motor de automação.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  messages,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and, desc, gte, asc } from "drizzle-orm";
import {
  scheduleConversationProcessing,
  incrementFloodCount,
  processConversation,
  tryAcquireConversationLock,
  releaseConversationLock,
  CONVERSATION_DEBOUNCE_MS,
} from "@/lib/conversation-engine/debouncer";
import { getRedis } from "@/lib/redis/redis-client";
import { logOrchestration } from "@/lib/orchestration/logger";

// Formato esperado da Evolution API (texto e mídia)
interface MessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: {
    caption?: string;
    url?: string;
    base64?: string;
    mimetype?: string;
  };
  audioMessage?: {
    url?: string;
    base64?: string;
    mimetype?: string;
    ptt?: boolean;
  };
  videoMessage?: {
    caption?: string;
    url?: string;
    base64?: string;
    mimetype?: string;
  };
  documentMessage?: {
    caption?: string;
    url?: string;
    base64?: string;
    mimetype?: string;
    fileName?: string;
  };
}

interface WebhookPayload {
  instance?: string;
  instanceName?: string;
  event?: string;
  eventType?: string;
  action?: string;
  sessionId?: string;
  data?: Record<string, unknown> & {
    key?: { remoteJid?: string; fromMe?: boolean };
    message?: MessageContent;
    state?: string;
    instance?: { state?: string };
  };
}

const HUMAN_REPLY_AI_PAUSE_MS = 60 * 60 * 1000; // 1 hora

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWebhookPhoneLockKey(sessionId: string, phone: string): string {
  return `lock:webhook:session:${sessionId}:phone:${phone}`;
}

async function acquireWebhookPhoneLock(
  sessionId: string,
  phone: string
): Promise<{ key: string; token: string; acquired: boolean }> {
  const key = buildWebhookPhoneLockKey(sessionId, phone);
  const token = crypto.randomUUID();
  try {
    const redis = getRedis();
    for (let attempt = 0; attempt < 30; attempt++) {
      const ok = await redis.set(key, token, { nx: true, ex: 10 });
      if (ok === "OK") {
        return { key, token, acquired: true };
      }
      await sleep(50);
    }
  } catch {
    // Se Redis indisponível, segue sem lock para não bloquear webhook.
  }
  return { key, token, acquired: false };
}

async function releaseWebhookPhoneLock(
  lock: { key: string; token: string; acquired: boolean }
): Promise<void> {
  if (!lock.acquired) return;
  try {
    const redis = getRedis();
    const current = await redis.get<string>(lock.key);
    if (current === lock.token) {
      await redis.del(lock.key);
    }
  } catch {
    // noop
  }
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "sim"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "nao", "não"].includes(normalized)) return false;
  }
  return null;
}

function resolveFromMe(
  payload: Record<string, unknown>,
  body: WebhookPayload
): boolean {
  const bodyData = (body.data ?? {}) as Record<string, unknown>;
  const payloadKey = payload.key as Record<string, unknown> | undefined;
  const bodyDataKey = bodyData.key as Record<string, unknown> | undefined;

  const candidates: unknown[] = [
    payloadKey?.fromMe,
    bodyDataKey?.fromMe,
    payload.fromMe,
    bodyData.fromMe,
  ];

  for (const candidate of candidates) {
    const parsed = parseBooleanLike(candidate);
    if (parsed !== null) return parsed;
  }

  return false;
}

function isMissingOnConflictConstraintError(err: unknown): boolean {
  const maybe = err as
    | { code?: string; cause?: { code?: string } }
    | undefined;
  const code = maybe?.code ?? maybe?.cause?.code ?? "";
  const msg = String(err ?? "").toLowerCase();
  return (
    code === "42P10" ||
    msg.includes("on conflict") ||
    msg.includes("no unique or exclusion constraint matching")
  );
}

function parsePresenceUpdate(body: WebhookPayload): {
  sessionId: string;
  remoteJid: string;
  presence: "composing" | "paused" | "available" | "unavailable" | "recording";
} | null {
  const event =
    body.event ?? body.eventType ?? (body as WebhookPayload).action;
  if (event !== "PRESENCE_UPDATE") return null;

  const sessionId =
    body.instance ?? body.instanceName ?? (body as WebhookPayload).sessionId;
  if (!sessionId || typeof sessionId !== "string") return null;

  const data = (body.data ?? body) as Record<string, unknown>;
  const key = data?.key as { remoteJid?: string } | undefined;
  let remoteJid = (data?.id ?? data?.remoteJid ?? key?.remoteJid) as string | undefined;
  const presences = data?.presences as Record<string, { lastKnownPresence?: string }> | undefined;
  let presence = (data?.lastKnownPresence ?? data?.presence ?? (remoteJid && presences?.[remoteJid]?.lastKnownPresence)) as string | undefined;

  if (presences && typeof presences === "object") {
    const firstKey = Object.keys(presences)[0];
    if (firstKey) {
      remoteJid = remoteJid ?? (typeof data?.id === "string" ? data.id : firstKey);
      presence = presence ?? presences[firstKey]?.lastKnownPresence;
    }
  }

  if (!remoteJid || typeof remoteJid !== "string") return null;
  if (!remoteJid.includes("@")) remoteJid = `${remoteJid}@s.whatsapp.net`;
  if (remoteJid.endsWith("@g.us")) return null; // ignora grupos

  const validPresence = ["composing", "paused", "available", "unavailable", "recording"].includes(
    String(presence ?? "").toLowerCase()
  )
    ? (String(presence).toLowerCase() as "composing" | "paused" | "available" | "unavailable" | "recording")
    : "paused";

  return { sessionId, remoteJid, presence: validPresence };
}

function parseConnectionStatus(body: WebhookPayload): {
  sessionId: string;
  status: "connected" | "disconnected";
} | null {
  const event =
    body.event ?? body.eventType ?? (body as WebhookPayload).action;
  if (event !== "CONNECTION_UPDATE") return null;

  const sessionId =
    body.instance ??
    body.instanceName ??
    (body as WebhookPayload).sessionId;
  if (!sessionId || typeof sessionId !== "string") return null;

  let state: unknown =
    (body.data as { state?: string })?.state ??
    (body.data as { instance?: { state?: string } })?.instance?.state ??
    body.data;
  if (typeof state !== "string") state = String(state ?? "").toLowerCase();

  const isConnected = ["open", "connected"].includes(
    String(state).toLowerCase()
  );
  return {
    sessionId,
    status: isConnected ? "connected" : "disconnected",
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as WebhookPayload;
    const conn = parseConnectionStatus(body);
    const presence = parsePresenceUpdate(body);

    // PRESENCE_UPDATE: contato digitando
    if (presence) {
      const phone = presence.remoteJid.replace("@s.whatsapp.net", "");
      const isTyping = presence.presence === "composing" || presence.presence === "recording";

      const [wsSession] = await db
        .select({
          id: whatsappSessions.id,
          organizationId: whatsappSessions.organizationId,
        })
        .from(whatsappSessions)
        .where(eq(whatsappSessions.sessionId, presence.sessionId))
        .limit(1);

      if (wsSession) {
        const [conv] = await db
          .select({
            id: conversations.id,
          })
          .from(conversations)
          .innerJoin(contacts, eq(conversations.contactId, contacts.id))
          .where(
            and(
              eq(contacts.organizationId, wsSession.organizationId),
              eq(contacts.phone, phone),
              eq(conversations.whatsappSessionId, wsSession.id)
            )
          )
          .orderBy(
            desc(conversations.lastMessageAt),
            desc(conversations.updatedAt),
            asc(conversations.createdAt)
          )
          .limit(1);

        if (conv) {
          await db
            .update(conversations)
            .set({
              contactTypingAt: isTyping ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, conv.id));
        }
      }
      return NextResponse.json({ ok: true });
    }

    // CONNECTION_UPDATE: atualizar status da sessão
    if (conn) {
      await db
        .update(whatsappSessions)
        .set({
          status: conn.status,
          lastConnectedAt:
            conn.status === "connected" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(whatsappSessions.sessionId, conn.sessionId));

      return NextResponse.json({ ok: true });
    }

    const sessionId = body.instance ?? body.instanceName ?? body.sessionId;

    // MESSAGES_UPSERT: Evolution API pode enviar payload em body.data ou no root
    const payload = (body.data ?? body) as Record<string, unknown>;
    const key = (payload?.key ?? body.data?.key) as { remoteJid?: string; fromMe?: boolean } | undefined;
    const msg = (payload?.message ?? body.data?.message) as MessageContent | undefined;

    const msgSessionId = sessionId;
    if (!msgSessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }

    const isInbound = !resolveFromMe(payload, body);
    let remoteJid = key?.remoteJid;
    if (typeof remoteJid === "string" && !remoteJid.includes("@")) {
      remoteJid = `${remoteJid}@s.whatsapp.net`;
    }

    if (!remoteJid) {
      return NextResponse.json({ ok: true });
    }

    // Ignora mensagens de grupos — só processa contatos diretos (@s.whatsapp.net)
    if (remoteJid.endsWith("@g.us")) {
      return NextResponse.json({ ok: true }); // Ignora grupos
    }

    // MENSAGEM OUTBOUND (humano respondeu pelo WhatsApp): desativa IA por 1h
    if (!isInbound) {
      const phone = remoteJid.replace("@s.whatsapp.net", "");

      const [session] = await db
        .select()
        .from(whatsappSessions)
        .where(eq(whatsappSessions.sessionId, msgSessionId))
        .limit(1);

      if (session) {
        const [convRow] = await db
          .select({
            conversation: conversations,
          })
          .from(conversations)
          .innerJoin(contacts, eq(conversations.contactId, contacts.id))
          .where(
            and(
              eq(contacts.organizationId, session.organizationId),
              eq(contacts.phone, phone),
              eq(conversations.whatsappSessionId, session.id)
            )
          )
          .orderBy(
            desc(conversations.lastMessageAt),
            desc(conversations.updatedAt),
            asc(conversations.createdAt)
          )
          .limit(1);
        const conversation = convRow?.conversation;

        if (conversation) {
          let outboundText = msg?.conversation ?? msg?.extendedTextMessage?.text ?? "";
          if (msg?.imageMessage) outboundText = msg.imageMessage.caption ?? outboundText;
          if (msg?.videoMessage) outboundText = msg.videoMessage?.caption ?? outboundText;
          if (msg?.documentMessage) outboundText = msg.documentMessage?.caption ?? outboundText;

          const preview =
            outboundText?.slice(0, 100) || "[mídia]";

          // Evita tratar eco da própria resposta da IA como "resposta humana"
          const outboundTrimmed = outboundText?.trim();
          if (outboundTrimmed) {
            const since45s = new Date(Date.now() - 45 * 1000);
            const [echo] = await db
              .select({ id: messages.id })
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, conversation.id),
                  eq(messages.direction, "outbound"),
                  eq(messages.content, outboundTrimmed),
                  gte(messages.createdAt, since45s)
                )
              )
              .limit(1);
            if (echo) {
              return NextResponse.json({ ok: true, ignoredBotEcho: true });
            }
          }

          await db.insert(messages).values({
            conversationId: conversation.id,
            direction: "outbound",
            contentType: "text",
            content: outboundText || null,
            status: "sent",
          });

          const oneHourFromNow = new Date(Date.now() + HUMAN_REPLY_AI_PAUSE_MS);

          await db
            .update(conversations)
            .set({
              lastMessageAt: new Date(),
              lastMessagePreview: preview,
              updatedAt: new Date(),
              // Sempre pausa IA quando houver resposta humana outbound
              aiDisabledUntil: oneHourFromNow,
            })
            .where(eq(conversations.id, conversation.id));
        }
      }
      return NextResponse.json({ ok: true });
    }

    // Extrair texto e mídia da mensagem (inbound)
    let messageText = msg?.conversation ?? msg?.extendedTextMessage?.text ?? "";
    let contentType = "text" as string;
    let mediaUrl: string | null = null;
    const metadata: Record<string, unknown> = {};

    if (msg?.imageMessage) {
      contentType = "image";
      messageText = msg.imageMessage.caption ?? messageText;
      mediaUrl = msg.imageMessage.base64
        ? `data:${msg.imageMessage.mimetype ?? "image/jpeg"};base64,${msg.imageMessage.base64}`
        : msg.imageMessage.url ?? null;
      metadata.mimetype = msg.imageMessage.mimetype;
    } else if (msg?.audioMessage) {
      contentType = msg.audioMessage.ptt ? "audio" : "audio";
      mediaUrl = msg.audioMessage.base64
        ? `data:${msg.audioMessage.mimetype ?? "audio/ogg"};base64,${msg.audioMessage.base64}`
        : msg.audioMessage.url ?? null;
      metadata.mimetype = msg.audioMessage.mimetype;
      metadata.ptt = msg.audioMessage.ptt;
    } else if (msg?.videoMessage) {
      contentType = "video";
      messageText = msg.videoMessage.caption ?? messageText;
      mediaUrl = msg.videoMessage.base64
        ? `data:${msg.videoMessage.mimetype ?? "video/mp4"};base64,${msg.videoMessage.base64}`
        : msg.videoMessage.url ?? null;
      metadata.mimetype = msg.videoMessage.mimetype;
    } else if (msg?.documentMessage) {
      contentType = "document";
      messageText = msg.documentMessage.caption ?? messageText;
      mediaUrl = msg.documentMessage.base64
        ? `data:${msg.documentMessage.mimetype ?? "application/octet-stream"};base64,${msg.documentMessage.base64}`
        : msg.documentMessage.url ?? null;
      metadata.mimetype = msg.documentMessage.mimetype;
      metadata.fileName = msg.documentMessage.fileName;
    }

    // Buscar sessão WhatsApp e organização
    const [session] = await db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.sessionId, msgSessionId))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const phone = remoteJid.replace("@s.whatsapp.net", "");
    const webhookPhoneLock = await acquireWebhookPhoneLock(msgSessionId, phone);

    const messagePreview =
      contentType === "text"
        ? messageText?.slice(0, 100)
        : `[${contentType}] ${messageText?.slice(0, 80) || ""}`.trim();
    let contact: typeof contacts.$inferSelect | undefined;
    let conversation: typeof conversations.$inferSelect | undefined;
    try {
      // Buscar contato canônico (mais antigo) por organização + número
      [contact] = await db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, session.organizationId),
            eq(contacts.phone, phone)
          )
        )
        .orderBy(asc(contacts.createdAt))
        .limit(1);

      if (!contact) {
        let inserted:
          | Array<(typeof contacts.$inferSelect)>
          | undefined;
        try {
          inserted = await db
            .insert(contacts)
            .values({
              organizationId: session.organizationId,
              phone,
            })
            .onConflictDoNothing({
              target: [contacts.organizationId, contacts.phone],
            })
            .returning();
        } catch (err) {
          if (!isMissingOnConflictConstraintError(err)) throw err;
          inserted = await db
            .insert(contacts)
            .values({
              organizationId: session.organizationId,
              phone,
            })
            .returning();
        }
        [contact] = inserted;
        if (!contact) {
          [contact] = await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.organizationId, session.organizationId),
                eq(contacts.phone, phone)
              )
            )
            .orderBy(asc(contacts.createdAt))
            .limit(1);
        }
      }

      if (!contact) {
        return NextResponse.json(
          { error: "Failed to get/create contact" },
          { status: 500 }
        );
      }

      // Buscar conversa canônica por sessão + número (independente de contactId duplicado)
      const [existingConv] = await db
        .select({
          conversation: conversations,
        })
        .from(conversations)
        .innerJoin(contacts, eq(conversations.contactId, contacts.id))
        .where(
          and(
            eq(contacts.organizationId, session.organizationId),
            eq(contacts.phone, phone),
            eq(conversations.whatsappSessionId, session.id)
          )
        )
        .orderBy(
          desc(conversations.lastMessageAt),
          desc(conversations.updatedAt),
          asc(conversations.createdAt)
        )
        .limit(1);
      conversation = existingConv?.conversation;

      if (!conversation) {
        let inserted:
          | Array<(typeof conversations.$inferSelect)>
          | undefined;
        try {
          inserted = await db
            .insert(conversations)
            .values({
              organizationId: session.organizationId,
              contactId: contact.id,
              whatsappSessionId: session.id,
              lastMessageAt: new Date(),
              lastMessagePreview: messagePreview,
            })
            .onConflictDoNothing({
              target: [conversations.contactId, conversations.whatsappSessionId],
            })
            .returning();
        } catch (err) {
          if (!isMissingOnConflictConstraintError(err)) throw err;
          inserted = await db
            .insert(conversations)
            .values({
              organizationId: session.organizationId,
              contactId: contact.id,
              whatsappSessionId: session.id,
              lastMessageAt: new Date(),
              lastMessagePreview: messagePreview,
            })
            .returning();
        }
        [conversation] = inserted;
        if (!conversation) {
          const [fallbackConv] = await db
            .select({
              conversation: conversations,
            })
            .from(conversations)
            .innerJoin(contacts, eq(conversations.contactId, contacts.id))
            .where(
              and(
                eq(contacts.organizationId, session.organizationId),
                eq(contacts.phone, phone),
                eq(conversations.whatsappSessionId, session.id)
              )
            )
            .orderBy(
              desc(conversations.lastMessageAt),
              desc(conversations.updatedAt),
              asc(conversations.createdAt)
            )
            .limit(1);
          conversation = fallbackConv?.conversation;
        }
      }
    } finally {
      await releaseWebhookPhoneLock(webhookPhoneLock);
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Failed to get/create conversation" },
        { status: 500 }
      );
    }
    const traceId = crypto.randomUUID();

    // Anti-flood: não inserir duplicata técnica de webhook retry (janela curta).
    // Janela longa engole respostas legítimas repetidas do cliente (ex.: "Mateus" novamente).
    const DUPLICATE_TEXT_WINDOW_MS = 8 * 1000;
    const sinceDuplicateWindow = new Date(Date.now() - DUPLICATE_TEXT_WINDOW_MS);
    if (messageText?.trim()) {
      const [dupe] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            eq(messages.direction, "inbound"),
            eq(messages.content, messageText.trim()),
            gte(messages.createdAt, sinceDuplicateWindow)
          )
        )
        .limit(1);
      if (dupe) {
        try {
          await scheduleConversationProcessing(conversation.id);
        } catch (scheduleErr) {
          // Mensagem duplicada não precisa fallback inline: evita processamentos paralelos/repetidos
          console.error(
            "[webhook whatsapp] schedule failed (duplicate), skipping inline fallback:",
            scheduleErr
          );
        }
        return NextResponse.json({ ok: true, duplicate: true });
      }
    }

    // Salvar mensagem recebida (texto e mídia)
    await db.insert(messages).values({
      conversationId: conversation.id,
      direction: "inbound",
      contentType,
      content: messageText || null,
      mediaUrl,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    await logOrchestration({
      conversationId: conversation.id,
      organizationId: session.organizationId,
      event: "webhook_inbound_received",
      reason: "Mensagem inbound recebida no webhook",
      traceId,
      stage: "webhook.inbound",
      decisionCode: "WEBHOOK_INBOUND_RECEIVED",
      metadata: {
        contentType,
        hasText: !!messageText?.trim(),
        fromMe: false,
      },
    });

    // Atualizar conversa
    await db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: messagePreview,
        unreadCount: conversation.unreadCount + 1,
      })
      .where(eq(conversations.id, conversation.id));

    // Anti flood: incrementa contador (INCR + EXPIRE 10)
    await incrementFloodCount(conversation.id);

    // Debounce distribuído (Redis + QStash): agenda processamento em 3s; nova mensagem cancela e reinicia.
    try {
      await scheduleConversationProcessing(conversation.id);
    } catch (scheduleErr) {
      console.error("[webhook whatsapp] schedule failed, fallback inline:", scheduleErr);
      await logOrchestration({
        conversationId: conversation.id,
        organizationId: session.organizationId,
        event: "webhook_schedule_fallback_inline",
        reason: "Falha no agendamento QStash; processando inline",
        traceId,
        stage: "webhook.schedule",
        decisionCode: "WEBHOOK_SCHEDULE_FALLBACK_INLINE",
        metadata: {
          error: String(scheduleErr),
        },
      });
      const acquired = await tryAcquireConversationLock(conversation.id);
      if (!acquired) {
        // Sem QStash, se o lock estiver ocupado, tenta novamente após o debounce.
        // Isso evita "engolir" mensagens quando vários webhooks chegam em sequência.
        await sleep(CONVERSATION_DEBOUNCE_MS);
        const retryAcquired = await tryAcquireConversationLock(conversation.id);
        if (!retryAcquired) {
          return NextResponse.json({ ok: true, fallbackSkipped: "lock_held" });
        }
        try {
          await processConversation(conversation.id);
        } finally {
          await releaseConversationLock(conversation.id);
        }
        return NextResponse.json({ ok: true, fallbackRetried: "lock_acquired_after_wait" });
      }
      try {
        // Sem QStash, aplica debounce local para agrupar mensagens quebradas.
        await sleep(CONVERSATION_DEBOUNCE_MS);
        await processConversation(conversation.id);
      } finally {
        await releaseConversationLock(conversation.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook whatsapp]", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
