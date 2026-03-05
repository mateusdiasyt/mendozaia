export interface ConversationEngineInput {
  organizationId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  messageContent: string;
  messageContentType: string;
  conversationState: string | null;
  aiDisabledUntil: Date | null;
  assignedToId: string | null;
  contactTagIds: string[];
  businessHours?: {
    start: string;
    end: string;
    timezone?: string;
  };
  inboundMessageId?: string;
  traceId?: string;
  /** Quando true, pula espera de typing e sleep de debounce (usado pelo debouncer por conversa) */
  skipBufferAndTypingWait?: boolean;
  /** Timestamp de início do engine (para verificar nova mensagem antes de enviar) */
  engineStartTime?: Date;
}

export interface ConversationEngineResult {
  mode:
    | "skipped_human_only"
    | "debounced"
    | "processed"
    | "escalated";
  replies: string[];
  automationDidReply: boolean;
  orchestratorDidReply: boolean;
  orchestratorDecision?: string;
  orchestratorReason?: string;
  silence: boolean;
  /** Se true, houve escalação para humano - não enviar respostas normais */
  escalated?: boolean;
}
