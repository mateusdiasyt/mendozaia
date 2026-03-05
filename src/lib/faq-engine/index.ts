/**
 * FAQ Engine: busca FAQ relevante, ranking, feedback e tracking de uso.
 * Camada ANTES da IA no orquestrador.
 */

import { db } from "@/lib/db";
import { faqEntries } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";
import { detectIntent } from "@/lib/ai-training/detect-intent";
import { textSimilarity } from "./normalize";

const MIN_CONFIDENCE = 80;
const LAST_USED_FAQ_TTL_S = 3600;

export interface RelevantFAQ {
  id: string;
  question: string;
  answer: string;
}

/** Busca FAQ relevante: mesmo intent, similaridade, confidenceScore >= 80 (Parte 5 e 6). */
export async function findRelevantFAQ(
  organizationId: string,
  message: string,
  minConfidence = MIN_CONFIDENCE
): Promise<RelevantFAQ | null> {
  const intent = detectIntent(message);
  const candidates = await db
    .select()
    .from(faqEntries)
    .where(
      and(
        eq(faqEntries.organizationId, organizationId),
        eq(faqEntries.intent, intent),
        sql`${faqEntries.confidenceScore} >= ${minConfidence}`
      )
    )
    .orderBy(
      desc(faqEntries.confidenceScore),
      desc(faqEntries.usageCount)
    )
    .limit(10);

  if (candidates.length === 0) return null;

  const withSim = candidates.map((c) => ({
    ...c,
    sim: textSimilarity(message, c.question),
  }));
  withSim.sort((a, b) => {
    const scoreA = a.confidenceScore / 100 + a.sim + Math.log(1 + a.usageCount);
    const scoreB = b.confidenceScore / 100 + b.sim + Math.log(1 + b.usageCount);
    return scoreB - scoreA;
  });

  const best = withSim[0];
  if (!best || best.sim < 0.3) return null;

  return {
    id: best.id,
    question: best.question,
    answer: best.answer,
  };
}

/** Incrementa usageCount da FAQ usada. */
export async function incrementFaqUsage(faqId: string): Promise<void> {
  await db
    .update(faqEntries)
    .set({
      usageCount: sql`${faqEntries.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(faqEntries.id, faqId));
}

/** Ajusta confidenceScore (Parte 7). Delta: negativo = resposta ruim, positivo = boa. */
export async function updateFaqConfidence(
  faqId: string,
  delta: number
): Promise<void> {
  const [row] = await db
    .select({ confidenceScore: faqEntries.confidenceScore })
    .from(faqEntries)
    .where(eq(faqEntries.id, faqId))
    .limit(1);
  if (!row) return;
  const next = Math.max(0, Math.min(200, row.confidenceScore + delta));
  await db
    .update(faqEntries)
    .set({ confidenceScore: next, updatedAt: new Date() })
    .where(eq(faqEntries.id, faqId));
}

export async function setLastUsedFaqId(
  conversationId: string,
  faqId: string
): Promise<void> {
  const redis = getRedis();
  await redis.set(REDIS_KEYS.lastUsedFaqId(conversationId), faqId, {
    ex: LAST_USED_FAQ_TTL_S,
  });
}

export async function getLastUsedFaqId(
  conversationId: string
): Promise<string | null> {
  const redis = getRedis();
  return redis.get<string>(REDIS_KEYS.lastUsedFaqId(conversationId));
}

export async function clearLastUsedFaqId(
  conversationId: string
): Promise<void> {
  const redis = getRedis();
  await redis.del(REDIS_KEYS.lastUsedFaqId(conversationId));
}

export { detectRepeatedQuestions } from "./detect-repeated-questions";
export type { RepeatedQuestionGroup } from "./detect-repeated-questions";
export { generateFAQEntry, generateFAQFromRepeatedGroup } from "./generate-faq";
