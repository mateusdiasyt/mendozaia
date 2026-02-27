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
  traceId?: string;
  stage?: string;
  decisionCode?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const metadata: Record<string, unknown> = {
      ...(params.metadata ?? {}),
      ...(params.traceId ? { traceId: params.traceId } : {}),
      ...(params.stage ? { stage: params.stage } : {}),
      ...(params.decisionCode ? { decisionCode: params.decisionCode } : {}),
      ...(typeof params.durationMs === "number" ? { durationMs: params.durationMs } : {}),
    };

    await db.insert(orchestrationLogs).values({
      conversationId: params.conversationId,
      organizationId: params.organizationId,
      event: params.event,
      stateBefore: params.stateBefore ?? null,
      stateAfter: params.stateAfter ?? null,
      decision: params.decision ?? null,
      reason: params.reason ?? null,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  } catch (err) {
    console.error("[orchestration] Log failed:", err);
  }
}
