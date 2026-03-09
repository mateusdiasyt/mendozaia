/**
 * Debounce distribuído por conversa (Redis + QStash).
 * Funciona em ambiente serverless (Vercel).
 *
 * Fluxo:
 * 1. Webhook recebe mensagem → scheduleConversationProcessing
 * 2. Cancela agendamento anterior (se existir) via QStash
 * 3. Agenda novo processamento em 3 segundos via QStash
 * 4. QStash entrega em /api/process-conversation após 3s
 * 5. API adquire lock Redis, processa, envia respostas
 */

import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  messages,
  whatsappSessions,
  contactTags,
  organizations,
} from "@/lib/db/schema";
import { eq, and, desc, gte, isNull } from "drizzle-orm";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
import { runConversationEngine } from "./engine";
import { createSendMessageExecutor } from "./executor";
import { logOrchestration } from "@/lib/orchestration/logger";
import { calculateHumanDelay } from "./humanize";
import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";
import { Client } from "@upstash/qstash";

/** Tempo de silêncio (sem novas mensagens) antes de processar */
export const CONVERSATION_DEBOUNCE_MS = 5_000;

/** Considera "digitando" se presence foi há menos que isso (ms) */
const TYPING_RECENT_MS = 5_000;

/** Delay ao reagendar quando usuário ainda está digitando */
const TYPING_RESCHEDULE_DELAY_MS = 3_000;

/** TTL do lock (evita deadlock se processamento travar; engine pode levar 60s+) */
const LOCK_TTL_S = 120;

/** TTL da chave de messageId no Redis (evitar perda em latência/fila) */
const DEBOUNCE_KEY_TTL_S = 120;

/** Limite de mensagens em 10s para considerar flood */
const FLOOD_THRESHOLD = 10;
const FLOOD_WINDOW_S = 10;
const FLOOD_RESCHEDULE_DELAY_MS = 8_000;

function getQStashClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error(
      "QSTASH_TOKEN é obrigatório para o debounce distribuído"
    );
  }
  return new Client({ token });
}

function getProcessConversationUrl(): string {
  const base =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!base) {
    throw new Error(
      "VERCEL_URL, APP_URL ou NEXT_PUBLIC_APP_URL é obrigatório para o QStash"
    );
  }
  return `${base.replace(/\/$/, "")}/api/process-conversation`;
}

/**
 * Processa a conversa: carrega dados, chama engine, envia respostas.
 * Usado pelo endpoint /api/process-conversation (invocado pelo QStash).
 */
export async function processConversation(
  conversationId: string
): Promise<void> {
  const traceId = crypto.randomUUID();

  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conv) {
      return;
    }

    const [session] = await db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.id, conv.whatsappSessionId))
      .limit(1);

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, conv.contactId))
      .limit(1);

    if (!session || !contact) {
      return;
    }

    const phone = contact.phone ?? "";

    // Buscar conteúdo combinado para delay humano (últimos 45s)
    const since45s = new Date(Date.now() - 45 * 1000);
    const inboundForLength = await db
      .select({ content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          gte(messages.createdAt, since45s),
          isNull(messages.processedAt)
        )
      );
    const combinedLength = inboundForLength.reduce(
      (sum, m) => sum + (m.content?.length ?? 0),
      0
    );

    const [latestInbound] = await db
      .select({
        id: messages.id,
        content: messages.content,
        contentType: messages.contentType,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound")
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const contactTagRows = await db
      .select({ tagId: contactTags.tagId })
      .from(contactTags)
      .where(eq(contactTags.contactId, contact.id));

    const [org] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    const settings = org?.settings as
      | {
          businessHours?: {
            start: string;
            end: string;
            timezone?: string;
          };
          aiAgent?: {
            enabled?: boolean;
            useAsFallback?: boolean;
            systemPrompt?: string;
            model?: string;
            apiKey?: string | null;
          };
        }
      | undefined;

    const engineStartTime = new Date();
    const sendMessage = createSendMessageExecutor({
      conversationId,
      sessionId: session.sessionId,
      phone,
      engineStartTime,
    });

    // Delay humano: simula tempo de leitura baseado no tamanho da mensagem
    const humanDelayMs = calculateHumanDelay(combinedLength);
    await sleep(humanDelayMs);
    console.log({
      stage: "worker_delay_applied",
      conversationId,
      messageLength: combinedLength,
      delayMs: humanDelayMs,
    });

    console.log({
      stage: "engine_executed",
      conversationId,
    });

    const engineResult = await runConversationEngine({
      organizationId: session.organizationId,
      conversationId,
      contactId: contact.id,
      contactPhone: phone,
      messageContent: latestInbound?.content ?? "",
      messageContentType: latestInbound?.contentType ?? "text",
      conversationState: conv.conversationState,
      isPriority: conv.isPriority ?? false,
      aiDisabledUntil: conv.aiDisabledUntil ?? null,
      assignedToId: conv.assignedToId,
      contactTagIds: contactTagRows.map((r) => r.tagId),
      businessHours: settings?.businessHours,
      inboundMessageId: latestInbound?.id,
      traceId,
      skipBufferAndTypingWait: false,
      engineStartTime,
    });

    let shouldReprocess = false;
    for (let i = 0; i < engineResult.replies.length; i++) {
      const ok = await sendMessage(conversationId, engineResult.replies[i]!, i);
      if (!ok) {
        shouldReprocess = true;
        break;
      }
    }

    if (shouldReprocess) {
      console.log({
        stage: "stale_response_reprocess",
        conversationId,
      });
      await scheduleConversationProcessing(conversationId);
      return;
    }

    // Só marcar como processadas quando de fato enviamos pelo menos uma resposta (evita "engolir" sem responder)
    if (engineResult.replies.length === 0) {
      console.log({
        stage: "no_replies_skip_mark",
        conversationId,
        mode: engineResult.mode,
      });
      // Retry único após 5s em caso de falha transitória (ex.: Gemini timeout)
      if (engineResult.mode === "processed") {
        await scheduleConversationProcessing(conversationId, 5_000);
      }
      return;
    }

    console.log({
      stage: "ai_multi_message_sent",
      conversationId,
      messagesCount: engineResult.replies.length,
    });

    // Marcar mensagens inbound consumidas (evita processar duas vezes)
    const since = new Date(Date.now() - 45 * 1000);
    await db
      .update(messages)
      .set({ processedAt: new Date() })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          gte(messages.createdAt, since),
          isNull(messages.processedAt)
        )
      );

    await logOrchestration({
      conversationId,
      organizationId: session.organizationId,
      event: "debouncer_processed",
      decision: "tool_then_ai",
      reason: "Processamento agendado por debounce concluído",
      traceId,
      stage: "conversation_engine.debouncer",
      decisionCode: "DEBOUNCER_PROCESSED",
      metadata: {
        repliesCount: engineResult.replies.length,
        mode: engineResult.mode,
      },
    });
  } catch (err) {
    console.error("[debouncer] processConversation error:", err);
    await logOrchestration({
      conversationId,
      organizationId: "",
      event: "debouncer_error",
      decision: "silence",
      reason: String(err),
      traceId,
      stage: "conversation_engine.debouncer",
      decisionCode: "DEBOUNCER_ERROR",
    });
  }
}

/**
 * Tenta adquirir lock distribuído. Retorna true se conseguiu.
 */
export async function tryAcquireConversationLock(
  conversationId: string
): Promise<boolean> {
  const redis = getRedis();
  const key = REDIS_KEYS.lock(conversationId);
  const result = await redis.set(key, "1", {
    nx: true,
    ex: LOCK_TTL_S,
  });
  return result === "OK";
}

/**
 * Libera o lock após processamento concluído.
 */
export async function releaseConversationLock(
  conversationId: string
): Promise<void> {
  const redis = getRedis();
  await redis.del(REDIS_KEYS.lock(conversationId));
}

/**
 * Verifica se há flood (>10 msgs em 10s). Se sim, reagenda com delay 8s e retorna true.
 */
export async function checkFloodAndRescheduleIfNeeded(
  conversationId: string
): Promise<boolean> {
  const redis = getRedis();
  const floodKey = REDIS_KEYS.flood(conversationId);
  const count = await redis.get<number>(floodKey);
  if (count === null || count <= FLOOD_THRESHOLD) return false;

  console.log({
    stage: "worker_flood_detected",
    conversationId,
    messageCount: count,
    rescheduleDelayMs: FLOOD_RESCHEDULE_DELAY_MS,
  });

  await scheduleConversationProcessing(conversationId, FLOOD_RESCHEDULE_DELAY_MS);
  return true;
}

/**
 * Incrementa contador de flood (chamado no webhook a cada mensagem).
 */
export async function incrementFloodCount(conversationId: string): Promise<void> {
  const redis = getRedis();
  const floodKey = REDIS_KEYS.flood(conversationId);
  await redis.incr(floodKey);
  await redis.expire(floodKey, FLOOD_WINDOW_S);
}

/**
 * Verifica se usuário está digitando (contactTypingAt < 3s).
 * Se sim, reagenda processamento para +2s e retorna true.
 */
export async function checkTypingAndRescheduleIfNeeded(
  conversationId: string
): Promise<boolean> {
  const [conv] = await db
    .select({ contactTypingAt: conversations.contactTypingAt })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const typingAt = conv?.contactTypingAt;
  if (!typingAt) return false;

  const elapsedMs = Date.now() - new Date(typingAt).getTime();
  if (elapsedMs >= TYPING_RECENT_MS) return false;

  console.log({
    stage: "debounce_typing_reschedule",
    conversationId,
    elapsedMs,
    rescheduleDelayMs: TYPING_RESCHEDULE_DELAY_MS,
  });

  await scheduleConversationProcessing(conversationId, TYPING_RESCHEDULE_DELAY_MS);
  return true;
}

/**
 * Agenda o processamento da conversa com debounce distribuído.
 * - Sempre cancela agendamento anterior (se existir) para evitar múltiplos jobs
 * - Agenda novo processamento via QStash
 * - Armazena messageId no Redis para permitir cancelamento
 */
export async function scheduleConversationProcessing(
  conversationId: string,
  delayMs: number = CONVERSATION_DEBOUNCE_MS
): Promise<void> {
  const redis = getRedis();
  const debounceKey = REDIS_KEYS.debounce(conversationId);

  // Sempre cancelar agendamento anterior (se DELETE falhar, job já executou — ignorar)
  const previousMessageId = await redis.get<string>(debounceKey);
  if (previousMessageId && typeof previousMessageId === "string") {
    try {
      const token = process.env.QSTASH_TOKEN;
      if (token) {
        const res = await fetch(
          `https://qstash.upstash.io/v2/messages/${previousMessageId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!res.ok) {
          // 404 = job já executou ou não existe — ignorar
          console.log({
            stage: "debounce_cancel_ignored",
            conversationId,
            messageId: previousMessageId,
            status: res.status,
          });
        }
      }
    } catch (err) {
      console.warn("[debouncer] Falha ao cancelar mensagem QStash (ignorando):", err);
    }
  }

  const url = getProcessConversationUrl();
  const client = getQStashClient();
  const delaySeconds = Math.max(1, Math.min(10, Math.ceil(delayMs / 1000)));
  const delayStr: "1s" | "2s" | "3s" | "4s" | "5s" | "6s" | "7s" | "8s" | "9s" | "10s" =
    delaySeconds <= 1 ? "1s" : delaySeconds <= 2 ? "2s" : delaySeconds <= 3 ? "3s"
    : delaySeconds <= 4 ? "4s" : delaySeconds <= 5 ? "5s" : delaySeconds <= 6 ? "6s"
    : delaySeconds <= 7 ? "7s" : delaySeconds <= 8 ? "8s" : delaySeconds <= 9 ? "9s" : "10s";

  const res = await client.publishJSON({
    url,
    body: { conversationId },
    delay: delayStr,
  });

  const messageId = Array.isArray(res) ? res[0]?.messageId : res?.messageId;
  if (messageId) {
    await redis.set(debounceKey, messageId, { ex: DEBOUNCE_KEY_TTL_S });
  }

  console.log({
    stage: "debounce_scheduled",
    conversationId,
    messageId: messageId ?? null,
    delaySeconds,
  });
}
