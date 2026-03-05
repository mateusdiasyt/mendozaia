/**
 * Memória leve do usuário em Redis.
 * Chave: user_memory:{phone}
 * TTL: 7 dias
 */

import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";

export interface UserMemory {
  name?: string;
  lastIntent?: string;
  lastTopic?: string;
  frustrationScore: number;
  lastInteractionAt: string; // ISO timestamp
}

const USER_MEMORY_TTL_S = 7 * 24 * 60 * 60; // 7 dias

function memoryKey(phone: string): string {
  const normalized = phone.replace(/\D/g, "");
  return REDIS_KEYS.userMemory(normalized);
}

export async function getUserMemory(phone: string): Promise<UserMemory | null> {
  const redis = getRedis();
  const key = memoryKey(phone);
  const data = await redis.get<string>(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as UserMemory;
  } catch {
    return null;
  }
}

export async function updateUserMemory(
  phone: string,
  patch: Partial<Omit<UserMemory, "lastInteractionAt">> & { lastInteractionAt?: string }
): Promise<void> {
  const redis = getRedis();
  const key = memoryKey(phone);
  const existing = await getUserMemory(phone);
  const now = new Date().toISOString();
  const updated: UserMemory = {
    name: patch.name ?? existing?.name,
    lastIntent: patch.lastIntent ?? existing?.lastIntent,
    lastTopic: patch.lastTopic ?? existing?.lastTopic,
    frustrationScore: patch.frustrationScore ?? existing?.frustrationScore ?? 0,
    lastInteractionAt: patch.lastInteractionAt ?? existing?.lastInteractionAt ?? now,
  };
  await redis.set(key, JSON.stringify(updated), { ex: USER_MEMORY_TTL_S });
}
