/**
 * Memória de longo prazo da conversa em Redis.
 * Chave: conversation_memory:{conversationId}
 * TTL: 30 dias
 */

import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";

export interface ConversationMemory {
  summary: string;
  mainTopic: string;
  intentHistory: string[];
  keyFacts: string[];
}

const CONVERSATION_MEMORY_TTL_S = 30 * 24 * 60 * 60; // 30 dias

function memoryKey(conversationId: string): string {
  return REDIS_KEYS.conversationMemory(conversationId);
}

export async function getConversationMemory(
  conversationId: string
): Promise<ConversationMemory | null> {
  const redis = getRedis();
  const key = memoryKey(conversationId);
  const data = await redis.get<string>(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as ConversationMemory;
  } catch {
    return null;
  }
}

export async function saveConversationMemory(
  conversationId: string,
  data: ConversationMemory
): Promise<void> {
  const redis = getRedis();
  const key = memoryKey(conversationId);
  await redis.set(key, JSON.stringify(data), {
    ex: CONVERSATION_MEMORY_TTL_S,
  });
}

/** Busca memórias recentes de conversas do mesmo contato (por phone via conversationId) */
export async function getRecentConversationMemoriesForContact(
  conversationIds: string[],
  limit = 3
): Promise<ConversationMemory[]> {
  const redis = getRedis();
  const results: ConversationMemory[] = [];
  for (const id of conversationIds.slice(0, limit)) {
    const data = await redis.get<string>(memoryKey(id));
    if (data) {
      try {
        results.push(JSON.parse(data) as ConversationMemory);
      } catch {
        /* ignore */
      }
    }
  }
  return results;
}
