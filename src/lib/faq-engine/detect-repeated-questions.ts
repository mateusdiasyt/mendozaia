/**
 * Detecta perguntas repetidas a partir das mensagens inbound dos últimos 30 dias.
 * Agrupa por similaridade; considera recorrente se >= MIN_OCCURRENCES.
 */

import { db } from "@/lib/db";
import { messages, conversations } from "@/lib/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { normalizeForFaq, textSimilarity } from "./normalize";
import { detectIntent } from "@/lib/ai-training/detect-intent";

const DAYS_LOOKBACK = 30;
const MIN_OCCURRENCES = 5;
const SIMILARITY_THRESHOLD = 0.7;

export interface RepeatedQuestionGroup {
  normalized: string;
  canonicalQuestion: string;
  count: number;
  intent: string;
}

/** Busca mensagens inbound de texto dos últimos 30 dias por organização. */
async function getRecentInboundMessages(
  organizationId: string
): Promise<{ content: string; createdAt: Date }[]> {
  const since = new Date();
  since.setDate(since.getDate() - DAYS_LOOKBACK);

  const rows = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(messages.direction, "inbound"),
        gte(messages.createdAt, since)
      )
    )
    .orderBy(desc(messages.createdAt));

  return rows
    .filter((r) => r.content?.trim() && (r.content?.length ?? 0) < 500)
    .map((r) => ({ content: r.content!.trim(), createdAt: r.createdAt }));
}

interface GroupAcc {
  canonicalQuestion: string;
  count: number;
}

/** Agrupa textos por similaridade; retorna grupos com count >= MIN_OCCURRENCES. */
function groupBySimilarity(
  items: { content: string }[],
  intent: string
): RepeatedQuestionGroup[] {
  const groups: GroupAcc[] = [];

  for (const item of items) {
    const normalized = normalizeForFaq(item.content);
    if (normalized.length < 3) continue;

    let found = false;
    for (const g of groups) {
      if (textSimilarity(g.canonicalQuestion, item.content) >= SIMILARITY_THRESHOLD) {
        g.count++;
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push({ canonicalQuestion: item.content, count: 1 });
    }
  }

  return groups
    .filter((g) => g.count >= MIN_OCCURRENCES)
    .map((g) => ({
      normalized: normalizeForFaq(g.canonicalQuestion),
      canonicalQuestion: g.canonicalQuestion,
      count: g.count,
      intent: detectIntent(g.canonicalQuestion),
    }));
}

/** Detecta perguntas repetidas por organização. Usa intent "support" para agrupamento global. */
export async function detectRepeatedQuestions(
  organizationId: string
): Promise<RepeatedQuestionGroup[]> {
  const recent = await getRecentInboundMessages(organizationId);
  if (recent.length === 0) return [];

  return groupBySimilarity(
    recent.map((r) => ({ content: r.content })),
    "support"
  );
}
