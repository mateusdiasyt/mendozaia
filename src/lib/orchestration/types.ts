/**
 * Tipos e constantes para orquestração de conversas.
 */

export const CONVERSATION_STATES = {
  INIT: "init",
  COLLECTING_INFO: "collecting_info",
  AWAITING_SYSTEM: "awaiting_system",
  READY_TO_CONFIRM: "ready_to_confirm",
  WAITING_HUMAN: "waiting_human",
  HUMAN_ACTIVE: "human_active",
  CLOSED: "closed",
} as const;

export type ConversationState = (typeof CONVERSATION_STATES)[keyof typeof CONVERSATION_STATES];

export type OrchestratorDecision =
  | "ai_respond"
  | "human_only"
  | "silence"
  | "automation_only"
  | "tool_then_ai";

import type { VehicleSlots } from "./slot-extractor";
export type { VehicleSlots } from "./slot-extractor";

export interface OrchestrationContext {
  conversationId: string;
  organizationId: string;
  contactId: string;
  contactPhone: string;
  messageContent: string;
  messageContentType: string;
  conversationState: string;
  aiDisabledUntil: Date | null;
  handoffReason: string | null;
  isPriority: boolean;
  assignedToId: string | null;
  reservationsEnabled: boolean;
  aiAgentEnabled: boolean;
  aiAgentUseAsFallback: boolean;
  /** Slots extraídos (modelo, ano, km) para fluxo de mecânica */
  vehicleSlots?: VehicleSlots;
  /** Se o prompt parece ser de mecânica (coleta de veículo) */
  usesVehicleSlots?: boolean;
  /** Última sugestão de horário pendente de confirmação do cliente */
  pendingReservation?: {
    dateStr: string;
    timeStr: string;
    durationMinutes: number;
  };
}

export interface OrchestratorResult {
  decision: OrchestratorDecision;
  reason: string;
  shouldRespond: boolean;
  shouldCallAI: boolean;
  stateAfter?: string;
}
