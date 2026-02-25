/**
 * Tipos e constantes do módulo de automação.
 * Estrutura modular: Gatilho → Condição → Ação
 */

// ==================== GATILHOS ====================

export const TRIGGER_TYPES = {
  MESSAGE_RECEIVED: "message_received",
  NO_REPLY_TIMEOUT: "no_reply_timeout",
} as const;

export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES];

// ==================== CONDIÇÕES ====================

export const CONDITION_TYPES = {
  NONE: "none",
  KEYWORD_CONTAINS: "keyword_contains",
  OUTSIDE_BUSINESS_HOURS: "outside_business_hours",
  MINUTES_WITHOUT_REPLY: "minutes_without_reply",
} as const;

export type ConditionType =
  (typeof CONDITION_TYPES)[keyof typeof CONDITION_TYPES];

export interface ConditionKeywordContains {
  keywords: string[];
}

export interface ConditionOutsideBusinessHours {
  message?: string;
}

export interface ConditionMinutesWithoutReply {
  minutes: number;
}

export type ConditionValue =
  | ConditionKeywordContains
  | ConditionOutsideBusinessHours
  | ConditionMinutesWithoutReply
  | Record<string, unknown>;

// ==================== AÇÕES ====================

export const ACTION_TYPES = {
  REPLY: "reply",
  AI_REPLY: "ai_reply",
  ADD_TAG: "add_tag",
  ASSIGN_TO_HUMAN: "assign_to_human",
} as const;

export type ActionType = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES];

export interface ActionReplyPayload {
  message: string;
}

export interface ActionAddTagPayload {
  tagId: string;
}

export interface ActionAssignToHumanPayload {
  message?: string;
}

export type ActionPayload =
  | ActionReplyPayload
  | ActionAddTagPayload
  | ActionAssignToHumanPayload
  | Record<string, unknown>;

// ==================== CONTEXTO DE EXECUÇÃO ====================

export interface AutomationContext {
  organizationId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  messageContent?: string;
  messageDirection: "inbound" | "outbound";
  lastMessageAt?: Date;
  lastOutboundAt?: Date;
  assignedToId?: string | null;
  contactTagIds: string[];
  businessHours?: {
    start: string;
    end: string;
    timezone?: string;
  };
}
