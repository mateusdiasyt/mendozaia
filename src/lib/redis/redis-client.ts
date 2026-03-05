/**
 * Cliente Redis (Upstash) para estado distribuído.
 * Usado pelo debouncer de conversas e locks.
 */

import { Redis } from "@upstash/redis";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN são obrigatórios para o debounce distribuído"
    );
  }
  return { url, token };
}

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!redisInstance) {
    const { url, token } = getRedisConfig();
    redisInstance = new Redis({ url, token });
  }
  return redisInstance;
}

/** Prefixos de chaves */
export const REDIS_KEYS = {
  debounce: (conversationId: string) =>
    `debounce:conversation:${conversationId}`,
  lock: (conversationId: string) => `lock:conversation:${conversationId}`,
  flood: (conversationId: string) => `flood:conversation:${conversationId}`,
  lastResponse: (conversationId: string) =>
    `last-response:conversation:${conversationId}`,
  userMemory: (phone: string) => `user_memory:${phone}`,
  customerProfile: (phone: string) => `customer_profile:${phone}`,
  conversationMemory: (conversationId: string) =>
    `conversation_memory:${conversationId}`,
  humanQueue: (orgId?: string) =>
    orgId ? `human_queue:${orgId}` : `human_queue`,
  aiTrainingExamples: () => `ai_training_examples`,
  lastUsedExampleIds: (conversationId: string) =>
    `last_used_example_ids:${conversationId}`,
  lastUsedFaqId: (conversationId: string) =>
    `last_used_faq_id:${conversationId}`,
} as const;
