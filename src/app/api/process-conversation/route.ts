/**
 * Endpoint invocado pelo QStash apos o debounce.
 * Adquire lock Redis e processa a conversa.
 *
 * Nota operacional:
 * este endpoint mantem processamento ativo mesmo quando a validacao de
 * assinatura do QStash nao esta funcional em producao.
 */

import { NextResponse } from "next/server";
import {
  processConversation,
  tryAcquireConversationLock,
  releaseConversationLock,
  checkTypingAndRescheduleIfNeeded,
  checkFloodAndRescheduleIfNeeded,
} from "@/lib/conversation-engine/debouncer";
import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";

async function handler(request: Request) {
  const body = (await request.json()) as { conversationId?: string };
  const conversationId = body?.conversationId;

  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json(
      { error: "conversationId obrigatorio" },
      { status: 400 }
    );
  }

  const acquired = await tryAcquireConversationLock(conversationId);
  if (!acquired) {
    return NextResponse.json({ ok: true, skipped: "lock_held" });
  }

  try {
    const floodRescheduled = await checkFloodAndRescheduleIfNeeded(conversationId);
    if (floodRescheduled) {
      await releaseConversationLock(conversationId);
      return NextResponse.json({ ok: true, skipped: "flood_reschedule" });
    }

    const typingRescheduled = await checkTypingAndRescheduleIfNeeded(conversationId);
    if (typingRescheduled) {
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

export const POST = handler;
