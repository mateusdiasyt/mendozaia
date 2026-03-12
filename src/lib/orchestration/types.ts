/**
 * Tipos e constantes para orquestraÃ§Ã£o de conversas.
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
import type { CustomerContext } from "@/lib/ai-agent";
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
  contactName?: string | null;
  reservationsEnabled: boolean;
  aiAgentEnabled: boolean;
  aiAgentUseAsFallback: boolean;
  /** Slots extraÃ­dos (modelo, ano, km) para fluxo de mecÃ¢nica */
  vehicleSlots?: VehicleSlots;
  /** Ãšltima especificaÃ§Ã£o de Ã³leo conhecida para o contato (ex.: 5W30) */
  knownOilSpec?: string | null;
  /** Se o prompt parece ser de mecÃ¢nica (coleta de veÃ­culo) */
  usesVehicleSlots?: boolean;
  /** Ãšltima sugestÃ£o de horÃ¡rio pendente de confirmaÃ§Ã£o do cliente */
  pendingReservation?: {
    dateStr: string;
    timeStr: string;
    durationMinutes: number;
  };
  reservationSchedule?: {
    start: string;
    end: string;
    timezone?: string;
    workingDays?: number[];
    blockedDates?: string[];
    lunchBreakStart?: string;
    lunchBreakEnd?: string;
    saturdayEnd?: string;
    dateOverrides?: Array<{
      date: string;
      start: string;
      end: string;
      lunchBreakStart?: string | null;
      lunchBreakEnd?: string | null;
      closed?: boolean;
    }>;
    weekdaySchedule?: Array<{
      day: number;
      enabled: boolean;
      start: string;
      end: string;
      lunchBreakStart?: string | null;
      lunchBreakEnd?: string | null;
    }>;
  };
  businessProfile?: {
    botName?: string | null;
    instagram?: string | null;
    address?: string | null;
    mapsLink?: string | null;
    about?: string | null;
  };
  botConfig?: {
    segment?: "mecanica" | "restaurante" | "geral";
    tone?: "formal" | "neutro" | "casual";
    language?: string;
  };
  vehicleServicePolicy?: {
    minAllowedYear?: number | null;
    supportedModels?: string[];
    blockedModels?: string[];
  };
  offeredServices?: string[];
  serviceHumanPolicyByName?: Record<string, boolean>;
  servicePriorityByName?: Record<string, number>;
  servicePromptByName?: Record<string, string>;
  /** Contexto do cliente (perfil + memÃ³ria de conversas anteriores) */
  customerContext?: CustomerContext | null;
}

export interface OrchestratorResult {
  decision: OrchestratorDecision;
  reason: string;
  shouldRespond: boolean;
  shouldCallAI: boolean;
  stateAfter?: string;
}

