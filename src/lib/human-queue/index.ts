/**
 * Fila inteligente para conversas aguardando humano.
 * Redis: human_queue (sorted set)
 * Ordenação: 1) urgência 2) prioridade 3) timestamp
 */

import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";

export interface HumanQueueEntry {
  conversationId: string;
  organizationId: string;
  priorityScore: number;
  urgency: "high" | "normal";
  timestamp: number;
}

function queueKey(orgId?: string): string {
  return REDIS_KEYS.humanQueue(orgId) ?? REDIS_KEYS.humanQueue();
}
const QUEUE_TTL_S = 7 * 24 * 60 * 60; // 7 dias

/**
 * Calcula score para ordenação: maior = mais prioritário.
 * Urgency high = 1000000 base, normal = 0
 * priorityScore = 0-10 (soma)
 * timestamp invertido para FIFO entre same priority
 */
function computeScore(entry: HumanQueueEntry): number {
  const urgencyBase = entry.urgency === "high" ? 1_000_000 : 0;
  const priorityPart = Math.min(10, Math.max(0, entry.priorityScore)) * 1000;
  const timePart = Math.max(0, 999 - Math.floor(entry.timestamp / 1000) % 1000);
  return urgencyBase + priorityPart + timePart;
}

export async function addToHumanQueue(entry: HumanQueueEntry): Promise<void> {
  const redis = getRedis();
  const key = queueKey(entry.organizationId);
  const score = computeScore(entry);
  const value = JSON.stringify({
    conversationId: entry.conversationId,
    organizationId: entry.organizationId,
    priorityScore: entry.priorityScore,
    urgency: entry.urgency,
    timestamp: entry.timestamp,
  });
  await redis.zadd(key, { score, member: value });
  await redis.expire(key, QUEUE_TTL_S);
}

export async function removeFromHumanQueue(
  conversationId: string,
  orgId?: string
): Promise<void> {
  const redis = getRedis();
  const key = queueKey(orgId);
  const members = await redis.zrange(key, 0, -1);
  for (const m of members) {
    try {
      const parsed = JSON.parse(m as string) as HumanQueueEntry;
      if (parsed.conversationId === conversationId) {
        await redis.zrem(key, m);
        return;
      }
    } catch {
      /* ignore */
    }
  }
}

export async function getHumanQueueTop(
  orgId?: string,
  limit = 20
): Promise<HumanQueueEntry[]> {
  const redis = getRedis();
  const key = queueKey(orgId);
  const members = await redis.zrange(key, 0, limit - 1, {
    rev: true,
  });
  const results: HumanQueueEntry[] = [];
  for (const m of members) {
    try {
      results.push(JSON.parse(m as string) as HumanQueueEntry);
    } catch {
      /* ignore */
    }
  }
  return results;
}
