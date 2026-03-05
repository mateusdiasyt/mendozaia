/**
 * Logs estruturados para monitoramento de inteligência conversacional.
 */

export type IntelligenceLogEvent =
  | "customer_profile_loaded"
  | "customer_profile_updated"
  | "conversation_memory_loaded"
  | "conversation_summary_created"
  | "priority_score_calculated"
  | "urgency_detected"
  | "human_queue_added";

export interface IntelligenceLogPayload {
  event: IntelligenceLogEvent;
  conversationId?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
}

export function logIntelligence(payload: IntelligenceLogPayload): void {
  console.log({
    ...payload,
    stage: "intelligence",
    timestamp: new Date().toISOString(),
  });
}
