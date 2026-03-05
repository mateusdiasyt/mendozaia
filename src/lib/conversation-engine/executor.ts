/**
 * Executor de envio de mensagens para o WhatsApp.
 * Usado pelo webhook e pelo debouncer para enviar respostas.
 * Inclui: typing indicator, delay humano, humanize, anti-duplicata Redis.
 */

import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";
import { humanizeTextResponse, randomDelay, maybeAddFiller } from "./humanize";
import { calculateMessageDelay } from "./multi-message";

const DUPLICATE_REPLY_WINDOW_MS = 20 * 1000; // 20s
const SEND_BEFORE_TYPING_WAIT_MS = 5_000;
const SEND_TYPING_POLL_MS = 400;
const TYPING_DELAY_MIN_MS = 1_500;
const TYPING_DELAY_MAX_MS = 3_000;
const LAST_RESPONSE_TTL_S = 120;
/** Só cancelar envio se nova mensagem chegou pelo menos N ms após início do engine (evita cancelar no mesmo burst) */
const STALE_GRACE_MS = 2_500;

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

async function sendTypingIndicator(
  apiUrl: string,
  apiKey: string | undefined,
  instanceName: string,
  number: string
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["apikey"] = apiKey;

  try {
    await fetch(
      `${apiUrl.replace(/\/$/, "")}/chat/sendPresence/${instanceName}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          number,
          delay: TYPING_DELAY_MAX_MS,
          presence: "composing",
        }),
      }
    );
  } catch (err) {
    console.warn("[executor] sendTypingIndicator failed:", err);
  }
}

async function waitIfContactTyping(
  conversationId: string,
  maxWaitMs: number = SEND_BEFORE_TYPING_WAIT_MS
): Promise<void> {
  let elapsed = 0;
  while (elapsed < maxWaitMs) {
    const [conv] = await db
      .select({ contactTypingAt: conversations.contactTypingAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    const typingAt = conv?.contactTypingAt;
    const isTyping =
      !!typingAt && Date.now() - new Date(typingAt).getTime() < 5_000;

    if (!isTyping) return;
    await new Promise((r) => setTimeout(r, SEND_TYPING_POLL_MS));
    elapsed += SEND_TYPING_POLL_MS;
  }
}

export interface ExecutorParams {
  conversationId: string;
  sessionId: string;
  phone: string;
  /** Se fornecido, verifica nova mensagem inbound antes de enviar (evita resposta desatualizada) */
  engineStartTime?: Date;
}

export function createSendMessageExecutor(
  params: ExecutorParams
): (convId: string, message: string, messageIndex?: number) => Promise<boolean> {
  const { conversationId, sessionId, phone, engineStartTime } = params;

  return async (convId: string, message: string, messageIndex = 0): Promise<boolean> => {
    await waitIfContactTyping(convId);

    // Segurança: só cancelar se nova mensagem chegou bem depois do início (evita cancelar no mesmo burst do cliente)
    if (engineStartTime) {
      const [latest] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, convId),
            eq(messages.direction, "inbound")
          )
        )
        .orderBy(desc(messages.createdAt))
        .limit(1);
      const graceTime = new Date(engineStartTime.getTime() + STALE_GRACE_MS);
      if (latest?.createdAt && new Date(latest.createdAt) > graceTime) {
        console.log({
          stage: "stale_response_cancelled",
          conversationId: convId,
          reason: "nova mensagem inbound após janela de graça",
        });
        return false; // sinaliza para reprocessar
      }
    }

    const apiUrl = process.env.WHATSAPP_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!apiUrl) {
      console.error("[executor] WHATSAPP_API_URL não configurada");
      return false; // falha de config → reprocessar
    }

    // Humanize: variação leve na resposta
    const humanizedMessage = humanizeTextResponse(message);

    // Anti-duplicata Redis: não enviar mesma resposta em 120s
    const redis = getRedis();
    const lastResponseKey = REDIS_KEYS.lastResponse(convId);
    const messageHash = simpleHash(humanizedMessage.trim());
    const lastHash = await redis.get<string>(lastResponseKey);
    if (lastHash === messageHash) {
      console.log({
        stage: "duplicate_response_avoided",
        conversationId: convId,
      });
      return true;
    }

    const [lastMessage] = await db
      .select({
        direction: messages.direction,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const isDuplicateReply =
      lastMessage?.direction === "outbound" &&
      !!lastMessage?.content &&
      lastMessage.content === humanizedMessage &&
      Date.now() - lastMessage.createdAt.getTime() <= DUPLICATE_REPLY_WINDOW_MS;
    if (isDuplicateReply) return true;

    // Simulação de digitação: typing indicator + delay por tamanho (700 + length*35)
    const number = phone.replace(/\D/g, "");
    await sendTypingIndicator(apiUrl, apiKey, sessionId, number);
    const typingDelayMs = calculateMessageDelay(humanizedMessage.length);
    await new Promise((r) => setTimeout(r, typingDelayMs));

    // Filler ocasional (máx 1 a cada 3 respostas)
    const filler = maybeAddFiller(messageIndex);
    const finalMessage = filler ? `${filler}\n\n${humanizedMessage}` : humanizedMessage;
    console.log({
      stage: "typing_indicator_sent",
      conversationId: convId,
      typingDelayMs,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["apikey"] = apiKey;
    }

    const res = await fetch(
      `${apiUrl.replace(/\/$/, "")}/message/sendText/${sessionId}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ number, text: finalMessage }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[executor] Evolution API sendText failed:", res.status, err);
      return false; // falha no envio → reprocessar
    }

    await db.insert(messages).values({
      conversationId: convId,
      direction: "outbound",
      contentType: "text",
      content: finalMessage,
      status: "sent",
    });
    await db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: finalMessage.slice(0, 100),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, convId));

    // Salvar hash da resposta no Redis (anti-duplicata)
    await redis.set(lastResponseKey, messageHash, { ex: LAST_RESPONSE_TTL_S });

    console.log({
      stage: "message_sent",
      conversationId: convId,
    });
    return true;
  };
}
