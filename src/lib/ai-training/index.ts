/**
 * Aprendizado com atendimento humano.
 * Exemplares salvos no banco (ai_training_examples).
 * Busca por intent + similaridade; ranking por usageCount e qualityScore.
 */

import { db } from "@/lib/db";
import { aiTrainingExamples } from "@/lib/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { getRedis, REDIS_KEYS } from "@/lib/redis/redis-client";
import { detectIntent } from "./detect-intent";

export type TrainingIntent = import("./detect-intent").TrainingIntent;

export interface TrainingExampleRow {
  id: string;
  organizationId: string;
  userMessage: string;
  humanReply: string;
  intent: string;
  usageCount: number;
  qualityScore: number;
  createdAt: Date;
}

export interface TrainingExampleForPrompt {
  id: string;
  userMessage: string;
  humanReply: string;
}

/** Salva exemplo quando humano responde (Parte 1 + 2). */
export async function saveTrainingExample(
  organizationId: string,
  userMessage: string,
  humanReply: string
): Promise<string> {
  const intent = detectIntent(userMessage);
  const [row] = await db
    .insert(aiTrainingExamples)
    .values({
      organizationId,
      userMessage: userMessage.trim(),
      humanReply: humanReply.trim(),
      intent,
      usageCount: 0,
      qualityScore: 100,
    })
    .returning({ id: aiTrainingExamples.id });
  return row?.id ?? "";
}

/** Detecta intenção da mensagem (Parte 3). */
export { detectIntent } from "./detect-intent";

/** Similaridade simples: palavras em comum normalizadas. */
function simpleSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .replace(/[^\w\sàáâãäéèêëíìîïóòôõöúùûüç]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
  const wordsB = b
    .toLowerCase()
    .replace(/[^\w\sàáâãäéèêëíìîïóòôõöúùûüç]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (wordsB.length === 0) return 0;
  let matches = 0;
  for (const w of wordsB) {
    if (wordsA.has(w)) matches++;
  }
  return matches / wordsB.length;
}

/** Busca até 3 exemplos relevantes: mesma intent, similaridade, mais recentes/usage (Parte 4). */
export async function findRelevantExamples(
  organizationId: string,
  message: string,
  limit = 3
): Promise<TrainingExampleForPrompt[]> {
  const intent = detectIntent(message);
  const candidates = await db
    .select()
    .from(aiTrainingExamples)
    .where(
      and(
        eq(aiTrainingExamples.organizationId, organizationId),
        eq(aiTrainingExamples.intent, intent)
      )
    )
    .orderBy(
      desc(aiTrainingExamples.qualityScore),
      desc(aiTrainingExamples.usageCount),
      desc(aiTrainingExamples.createdAt)
    )
    .limit(limit * 3);

  const withScore = candidates.map((c) => ({
    ...c,
    sim: simpleSimilarity(message, c.userMessage),
  }));
  withScore.sort((a, b) => {
    const scoreA = a.qualityScore / 100 + a.sim + Math.log(1 + a.usageCount);
    const scoreB = b.qualityScore / 100 + b.sim + Math.log(1 + b.usageCount);
    return scoreB - scoreA;
  });

  return withScore.slice(0, limit).map((c) => ({
    id: c.id,
    userMessage: c.userMessage,
    humanReply: c.humanReply,
  }));
}

/** Incrementa usageCount dos exemplos usados (Parte 6). */
export async function incrementUsageCount(
  exampleIds: string[]
): Promise<void> {
  for (const id of exampleIds) {
    await db
      .update(aiTrainingExamples)
      .set({
        usageCount: sql`${aiTrainingExamples.usageCount} + 1`,
      })
      .where(eq(aiTrainingExamples.id, id));
  }
}

/** Ajusta qualityScore (Parte 8 e 9). Delta positivo = boa resposta, negativo = ruim. */
export async function updateQualityScore(
  exampleId: string,
  delta: number
): Promise<void> {
  const [row] = await db
    .select({ qualityScore: aiTrainingExamples.qualityScore })
    .from(aiTrainingExamples)
    .where(eq(aiTrainingExamples.id, exampleId))
    .limit(1);
  if (!row) return;
  const next = Math.max(0, Math.min(200, row.qualityScore + delta));
  await db
    .update(aiTrainingExamples)
    .set({ qualityScore: next })
    .where(eq(aiTrainingExamples.id, exampleId));
}

/** Diminui score dos exemplos usados quando cliente diz "não entendi" etc. (Parte 8). */
export async function decreaseQualityForUsedExamples(
  exampleIds: string[],
  delta = -15
): Promise<void> {
  for (const id of exampleIds) {
    await updateQualityScore(id, delta);
  }
}

/** Remove exemplos com usageCount = 0 e mais antigos que 60 dias (Parte 7). */
export async function cleanupOldUnusedExamples(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const toDelete = await db
    .select({ id: aiTrainingExamples.id })
    .from(aiTrainingExamples)
    .where(
      and(
        eq(aiTrainingExamples.usageCount, 0),
        sql`${aiTrainingExamples.createdAt} < ${cutoff}`
      )
    );
  if (toDelete.length === 0) return 0;
  await db
    .delete(aiTrainingExamples)
    .where(inArray(aiTrainingExamples.id, toDelete.map((r) => r.id)));
  return toDelete.length;
}

// --- Compatibilidade com código que ainda usa Redis (learnFromHumanMessage com orgId)

/** Chamado quando humano envia mensagem: salva no banco (Parte 1). */
export async function learnFromHumanMessage(
  userMessage: string,
  humanReply: string,
  organizationId: string
): Promise<string> {
  return saveTrainingExample(organizationId, userMessage, humanReply);
}

// --- IDs dos exemplos usados na última resposta (para Parte 8: diminuir score em "não entendi")

const LAST_USED_TTL_S = 3600; // 1 hora

export async function setLastUsedExampleIds(
  conversationId: string,
  exampleIds: string[]
): Promise<void> {
  if (exampleIds.length === 0) return;
  const redis = getRedis();
  await redis.set(
    REDIS_KEYS.lastUsedExampleIds(conversationId),
    JSON.stringify(exampleIds),
    { ex: LAST_USED_TTL_S }
  );
}

export async function getLastUsedExampleIds(
  conversationId: string
): Promise<string[]> {
  const redis = getRedis();
  const raw = await redis.get<string>(REDIS_KEYS.lastUsedExampleIds(conversationId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function clearLastUsedExampleIds(
  conversationId: string
): Promise<void> {
  const redis = getRedis();
  await redis.del(REDIS_KEYS.lastUsedExampleIds(conversationId));
}

/** Detecta se a mensagem do cliente é feedback negativo (Parte 8). */
export function isNegativeFeedback(text: string): boolean {
  const t = text.trim().toLowerCase();
  const patterns = [
    /não\s+entendi/i,
    /nao\s+entendi/i,
    /isso\s+não\s+ajudou/i,
    /não\s+foi\s+isso\s+que\s+perguntei/i,
    /não\s+era\s+isso/i,
    /tá\s+errado/i,
    /ta\s+errado/i,
    /resposta\s+ruim/i,
    /não\s+respondeu\s+(direito|bem)/i,
  ];
  return patterns.some((p) => p.test(t));
}
