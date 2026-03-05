/**
 * Executor de envio de mensagens para o WhatsApp.
 * Usado pelo webhook e pelo debouncer para enviar respostas.
 */

import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

const DUPLICATE_REPLY_WINDOW_MS = 20 * 1000; // 20s
const SEND_BEFORE_TYPING_WAIT_MS = 5_000;
const SEND_TYPING_POLL_MS = 400;

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
}

export function createSendMessageExecutor(
  params: ExecutorParams
): (convId: string, message: string) => Promise<void> {
  const { conversationId, sessionId, phone } = params;

  return async (convId: string, message: string) => {
    await waitIfContactTyping(convId);

    const apiUrl = process.env.WHATSAPP_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!apiUrl) {
      console.error("[executor] WHATSAPP_API_URL não configurada");
      return;
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
      lastMessage.content === message &&
      Date.now() - lastMessage.createdAt.getTime() <= DUPLICATE_REPLY_WINDOW_MS;
    if (isDuplicateReply) return;

    const instanceName = sessionId;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["apikey"] = apiKey;
    }

    const number = phone.replace(/\D/g, "");
    const res = await fetch(
      `${apiUrl.replace(/\/$/, "")}/message/sendText/${instanceName}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ number, text: message }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[executor] Evolution API sendText failed:", res.status, err);
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
  };
}
