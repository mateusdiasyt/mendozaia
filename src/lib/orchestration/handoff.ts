/**
 * Handoff humano - transferência e retorno da conversa.
 */

import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logOrchestration } from "./logger";
import { CONVERSATION_STATES } from "./types";
import { addToHumanQueue } from "@/lib/human-queue";
import {
  saveConversationMemory,
  type ConversationMemory,
} from "@/lib/conversation-memory";
import { logIntelligence } from "@/lib/intelligence-logger";
import { removeFromHumanQueue } from "@/lib/human-queue";

export interface HandoffOptions {
  reason?: string;
  priorityScore?: number;
  urgency?: "high" | "normal";
  /** Resumo e keyFacts para memória de longo prazo */
  conversationSummary?: { summary: string; mainTopic: string; keyFacts: string[] };
}

/** Handoff para humano: IA para de responder, conversa aguarda atendimento. */
export async function handoffToHuman(
  conversationId: string,
  organizationId: string,
  reason?: string,
  options?: HandoffOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conv) return { success: false, error: "Conversa não encontrada" };
    if (conv.organizationId !== organizationId) {
      return { success: false, error: "Não autorizado" };
    }

    const stateBefore = conv.conversationState ?? CONVERSATION_STATES.INIT;
    const aiDisabledUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 ano
    const priorityScore = options?.priorityScore ?? 5;
    const isHighPriority = priorityScore >= 5;
    const urgency = options?.urgency ?? "normal";

    await db
      .update(conversations)
      .set({
        conversationState: CONVERSATION_STATES.WAITING_HUMAN,
        handoffReason: reason ?? "Solicitação do cliente",
        handoffAt: new Date(),
        isPriority: isHighPriority,
        aiDisabledUntil,
        assignedToId: null,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    await addToHumanQueue({
      conversationId,
      organizationId,
      priorityScore,
      urgency,
      timestamp: Date.now(),
    });
    logIntelligence({
      event: "human_queue_added",
      conversationId,
      organizationId,
      metadata: { priorityScore, urgency },
    });

    if (options?.conversationSummary) {
      const mem: ConversationMemory = {
        summary: options.conversationSummary.summary,
        mainTopic: options.conversationSummary.mainTopic,
        intentHistory: [],
        keyFacts: options.conversationSummary.keyFacts,
      };
      await saveConversationMemory(conversationId, mem);
      logIntelligence({
        event: "conversation_summary_created",
        conversationId,
        organizationId,
        metadata: { summary: mem.summary },
      });
    }

    await logOrchestration({
      conversationId,
      organizationId,
      event: "handoff",
      stateBefore,
      stateAfter: CONVERSATION_STATES.WAITING_HUMAN,
      decision: "human_only",
      reason: reason ?? "handoff_requested",
      metadata: {
        handoffAt: new Date().toISOString(),
        priorityScore,
        urgency,
      },
    });

    return { success: true };
  } catch (err) {
    console.error("[handoff] handoffToHuman failed:", err);
    return { success: false, error: String(err) };
  }
}

/** Retorna a IA ao fluxo após operador liberar. */
export async function resumeFromHuman(
  conversationId: string,
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await removeFromHumanQueue(conversationId, organizationId);

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conv) return { success: false, error: "Conversa não encontrada" };
    if (conv.organizationId !== organizationId) {
      return { success: false, error: "Não autorizado" };
    }

    const stateBefore = conv.conversationState ?? CONVERSATION_STATES.INIT;
    const metadata = (conv.conversationStateMetadata as Record<string, unknown>) ?? {};
    delete metadata.vehicleSlots;

    await db
      .update(conversations)
      .set({
        conversationState: CONVERSATION_STATES.INIT,
        handoffReason: null,
        handoffAt: null,
        isPriority: false,
        aiDisabledUntil: null,
        conversationStateMetadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    await logOrchestration({
      conversationId,
      organizationId,
      event: "resume_from_human",
      stateBefore,
      stateAfter: CONVERSATION_STATES.INIT,
      decision: "ai_respond",
      reason: "operator_released",
    });

    return { success: true };
  } catch (err) {
    console.error("[handoff] resumeFromHuman failed:", err);
    return { success: false, error: String(err) };
  }
}
