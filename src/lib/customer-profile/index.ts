/**
 * Perfil automático do cliente em Redis.
 * Chave: customer_profile:{phone}
 * TTL: 30 dias
 */

import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";

export interface CustomerProfile {
  name?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  totalMessages: number;
  totalConversations: number;
  lastIntent?: string;
  preferredTopic?: string;
  frustrationScore: number;
  vipScore: number;
}

const CUSTOMER_PROFILE_TTL_S = 30 * 24 * 60 * 60; // 30 dias

function profileKey(phone: string): string {
  const normalized = phone.replace(/\D/g, "");
  return REDIS_KEYS.customerProfile(normalized);
}

export async function getCustomerProfile(
  phone: string
): Promise<CustomerProfile | null> {
  const redis = getRedis();
  const key = profileKey(phone);
  const data = await redis.get<string>(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as CustomerProfile;
  } catch {
    return null;
  }
}

export async function updateCustomerProfile(
  phone: string,
  patch: Partial<Omit<CustomerProfile, "firstSeenAt">> & {
    firstSeenAt?: string;
  }
): Promise<void> {
  const redis = getRedis();
  const key = profileKey(phone);
  const existing = await getCustomerProfile(phone);
  const now = new Date().toISOString();

  const updated: CustomerProfile = {
    name: patch.name ?? existing?.name,
    firstSeenAt: patch.firstSeenAt ?? existing?.firstSeenAt ?? now,
    lastSeenAt: patch.lastSeenAt ?? now,
    totalMessages: patch.totalMessages ?? existing?.totalMessages ?? 0,
    totalConversations:
      patch.totalConversations ?? existing?.totalConversations ?? 0,
    lastIntent: patch.lastIntent ?? existing?.lastIntent,
    preferredTopic: patch.preferredTopic ?? existing?.preferredTopic,
    frustrationScore: patch.frustrationScore ?? existing?.frustrationScore ?? 0,
    vipScore: patch.vipScore ?? existing?.vipScore ?? 0,
  };

  await redis.set(key, JSON.stringify(updated), {
    ex: CUSTOMER_PROFILE_TTL_S,
  });
}
