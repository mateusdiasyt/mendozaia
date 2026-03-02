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
}

export interface ConversationEngineResult {
  mode:
    | "skipped_human_only"
    | "debounced"
    | "processed";
  replies: string[];
  automationDidReply: boolean;
  orchestratorDidReply: boolean;
  orchestratorDecision?: string;
  orchestratorReason?: string;
  silence: boolean;
}
