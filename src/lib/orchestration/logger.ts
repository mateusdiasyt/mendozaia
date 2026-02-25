/**
 * Logs profissionais de orquestração.
 */

import { db } from "@/lib/db";
import { orchestrationLogs } from "@/lib/db/schema";

export async function logOrchestration(params: {
  conversationId: string;
  organizationId: string;
  event: string;
  stateBefore?: string;
  stateAfter?: string;
  decision?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(orchestrationLogs).values({
      conversationId: params.conversationId,
      organizationId: params.organizationId,
      event: params.event,
      stateBefore: params.stateBefore ?? null,
      stateAfter: params.stateAfter ?? null,
      decision: params.decision ?? null,
      reason: params.reason ?? null,
      metadata: params.metadata ?? undefined,
    });
  } catch (err) {
    console.error("[orchestration] Log failed:", err);
  }
}
