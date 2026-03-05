/**
 * Endpoint invocado pelo QStash após o debounce (3s sem novas mensagens).
 * Verifica assinatura, adquire lock Redis e processa a conversa.
 */

import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import {
  processConversation,
  tryAcquireConversationLock,
  releaseConversationLock,
  checkTypingAndRescheduleIfNeeded,
} from "@/lib/conversation-engine/debouncer";
import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";

async function handler(request: Request) {
  const body = (await request.json()) as { conversationId?: string };
  const conversationId = body?.conversationId;

  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json(
      { error: "conversationId obrigatório" },
      { status: 400 }
    );
  }

  const acquired = await tryAcquireConversationLock(conversationId);
  if (!acquired) {
    return NextResponse.json({ ok: true, skipped: "lock_held" });
  }

  try {
    // Debounce inteligente: se usuário ainda digitando, reagendar +2s
    const rescheduled = await checkTypingAndRescheduleIfNeeded(conversationId);
    if (rescheduled) {
      await releaseConversationLock(conversationId);
      return NextResponse.json({ ok: true, skipped: "typing_reschedule" });
    }

    console.log({
      stage: "worker_started",
      conversationId,
    });

    await processConversation(conversationId);
  } finally {
    await releaseConversationLock(conversationId);
    const redis = getRedis();
    await redis.del(REDIS_KEYS.debounce(conversationId));
  }

  return NextResponse.json({ ok: true });
}

const hasQStashSigningKeys =
  !!process.env.QSTASH_CURRENT_SIGNING_KEY &&
  !!process.env.QSTASH_NEXT_SIGNING_KEY;

export const POST = hasQStashSigningKeys
  ? verifySignatureAppRouter(handler)
  : async () =>
      NextResponse.json(
        { error: "QStash não configurado (QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY)" },
        { status: 503 }
      );
