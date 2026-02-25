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
  contactTags,
  organizations,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { processMessageReceivedRules } from "@/lib/automation/engine";
import { processInboundMessage } from "@/lib/orchestration";

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
        .select({ id: whatsappSessions.id })
        .from(whatsappSessions)
        .where(eq(whatsappSessions.sessionId, presence.sessionId))
        .limit(1);

      if (wsSession) {
        const [conv] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .innerJoin(contacts, eq(conversations.contactId, contacts.id))
          .where(
            and(
              eq(contacts.phone, phone),
              eq(conversations.whatsappSessionId, wsSession.id)
            )
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

    const isInbound = !key?.fromMe;
    let remoteJid = key?.remoteJid;
    if (typeof remoteJid === "string" && !remoteJid.includes("@")) {
      remoteJid = `${remoteJid}@s.whatsapp.net`;
    }

    if (!isInbound || !remoteJid) {
      return NextResponse.json({ ok: true }); // Ignora mensagens outbound
    }

    // Ignora mensagens de grupos — só processa contatos diretos (@s.whatsapp.net)
    if (remoteJid.endsWith("@g.us")) {
      return NextResponse.json({ ok: true }); // Ignora grupos
    }

    // Extrair texto e mídia da mensagem
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

    // Buscar ou criar contato
    let [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, session.organizationId),
          eq(contacts.phone, phone)
        )
      )
      .limit(1);

    if (!contact) {
      [contact] = await db
        .insert(contacts)
        .values({
          organizationId: session.organizationId,
          phone,
        })
        .returning();
    }

    if (!contact) {
      return NextResponse.json(
        { error: "Failed to get/create contact" },
        { status: 500 }
      );
    }

    // Buscar ou criar conversa
    let [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.contactId, contact.id),
          eq(conversations.whatsappSessionId, session.id)
        )
      )
      .limit(1);

    const messagePreview =
      contentType === "text"
        ? messageText?.slice(0, 100)
        : `[${contentType}] ${messageText?.slice(0, 80) || ""}`.trim();

    if (!conversation) {
      [conversation] = await db
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

    if (!conversation) {
      return NextResponse.json(
        { error: "Failed to get/create conversation" },
        { status: 500 }
      );
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

    // Atualizar conversa
    await db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: messagePreview,
        unreadCount: conversation.unreadCount + 1,
      })
      .where(eq(conversations.id, conversation.id));

    // Buscar tags do contato
    const contactTagRows = await db
      .select({ tagId: contactTags.tagId })
      .from(contactTags)
      .where(eq(contactTags.contactId, contact.id));

    // Horário comercial da organização (settings)
    const [org] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    const settings = org?.settings as
      | {
          businessHours?: { start: string; end: string; timezone?: string };
          aiAgent?: { enabled?: boolean; useAsFallback?: boolean; systemPrompt?: string; model?: string; apiKey?: string | null };
        }
      | undefined;

    const executor = {
      sendMessage: async (convId: string, message: string) => {
        const apiUrl = process.env.WHATSAPP_API_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;
        if (!apiUrl) {
          console.error("[webhook] WHATSAPP_API_URL não configurada");
          return;
        }

        const instanceName = session.sessionId;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) {
          headers["apikey"] = apiKey;
        }

        const number = phone.replace(/\D/g, "");
        const res = await fetch(`${apiUrl.replace(/\/$/, "")}/message/sendText/${instanceName}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ number, text: message }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error("[webhook] Evolution API sendText failed:", res.status, err);
          return;
        }

        await db.insert(messages).values({
          conversationId: convId,
          direction: "outbound",
          contentType: "text",
          content: message,
          status: "sent",
        });
        await db
          .update(conversations)
          .set({
            lastMessageAt: new Date(),
            lastMessagePreview: message.slice(0, 100),
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, convId));
      },
    };

    const context = {
      organizationId: session.organizationId,
      conversationId: conversation.id,
      contactId: contact.id,
      contactPhone: phone,
      messageContent: messageText || undefined,
      messageDirection: "inbound" as const,
      lastMessageAt: new Date(),
      assignedToId: conversation.assignedToId,
      contactTagIds: contactTagRows.map((r) => r.tagId),
      businessHours: settings?.businessHours,
      aiDisabledUntil: conversation.aiDisabledUntil ?? null,
    };

    const { didReply } = await processMessageReceivedRules(context, executor);

    // Orquestrador: IA nunca responde diretamente, passa por esta camada
    await processInboundMessage(
      {
        conversationId: conversation.id,
        organizationId: session.organizationId,
        contactId: contact.id,
        contactPhone: phone,
        messageContent: messageText || "",
        messageContentType: contentType,
      },
      {
        automationDidReply: didReply,
        sendMessage: async (convId, text) => {
          if (executor.sendMessage) await executor.sendMessage(convId, text);
        },
      }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook whatsapp]", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
