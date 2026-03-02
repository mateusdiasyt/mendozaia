import { and, desc, eq } from "drizzle-orm";
import { processMessageReceivedRules } from "@/lib/automation/engine";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { processInboundMessage } from "@/lib/orchestration";
import { logOrchestration } from "@/lib/orchestration/logger";
import type { ConversationEngineInput, ConversationEngineResult } from "./types";

const INBOUND_DEBOUNCE_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushReply(replies: string[], text: string): void {
  const normalized = text.trim();
  if (!normalized) return;
  const lastReply = replies[replies.length - 1];
  if (lastReply === normalized) return;
  replies.push(normalized);
}

export async function runConversationEngine(
  input: ConversationEngineInput
): Promise<ConversationEngineResult> {
  const replies: string[] = [];
  const now = new Date();
  const isAiPaused = !!(input.aiDisabledUntil && input.aiDisabledUntil > now);
  const isHumanOnlyState =
    input.conversationState === "waiting_human" ||
    input.conversationState === "human_active";

  if (isAiPaused || isHumanOnlyState) {
    await logOrchestration({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      event: "conversation_engine_skipped",
      decision: "human_only",
      reason: isAiPaused
        ? "IA pausada no contato; engine não executa automação/orquestrador"
        : "Conversa em estado humano; engine não executa automação/orquestrador",
      traceId: input.traceId,
      stage: "conversation_engine.guard",
      decisionCode: "ENGINE_SKIP_AUTOMATION_ORCHESTRATOR",
      metadata: {
        aiDisabledUntil: input.aiDisabledUntil
          ? input.aiDisabledUntil.toISOString()
          : null,
        conversationState: input.conversationState ?? null,
      },
    });

    return {
      mode: "skipped_human_only",
      replies,
      automationDidReply: false,
      orchestratorDidReply: false,
      silence: true,
    };
  }

  if (
    input.messageContentType === "text" &&
    input.messageContent.trim() &&
    input.inboundMessageId
  ) {
    await sleep(INBOUND_DEBOUNCE_MS);
    const [latestInbound] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, "inbound")
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (
      latestInbound?.id &&
      latestInbound.id !== input.inboundMessageId
    ) {
      await logOrchestration({
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        event: "conversation_engine_debounced",
        decision: "tool_then_ai",
        reason: "Mensagem inbound mais nova detectada; aguardando composição",
        traceId: input.traceId,
        stage: "conversation_engine.debounce",
        decisionCode: "ENGINE_DEBOUNCED",
      });
      return {
        mode: "debounced",
        replies,
        automationDidReply: false,
        orchestratorDidReply: false,
        silence: true,
      };
    }
  }

  const automationStartedAt = Date.now();
  const { didReply: automationDidReply } = await processMessageReceivedRules(
    {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      contactPhone: input.contactPhone,
      messageContent: input.messageContent,
      messageDirection: "inbound",
      lastMessageAt: new Date(),
      assignedToId: input.assignedToId,
      contactTagIds: input.contactTagIds,
      businessHours: input.businessHours,
      aiDisabledUntil: input.aiDisabledUntil,
    },
    {
      sendMessage: async (_convId, text) => {
        pushReply(replies, text);
      },
    }
  );

  await logOrchestration({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    event: "automation_processed",
    decision: automationDidReply ? "automation_only" : "tool_then_ai",
    reason: automationDidReply
      ? "Automação respondeu antes do orquestrador"
      : "Automação não respondeu; segue para orquestrador",
    traceId: input.traceId,
    stage: "automation.engine",
    decisionCode: automationDidReply
      ? "AUTOMATION_REPLIED"
      : "AUTOMATION_NO_REPLY",
    durationMs: Date.now() - automationStartedAt,
    metadata: {
      didReply: automationDidReply,
    },
  });

  const orchestratorStartedAt = Date.now();
  const orchestratorResult = await processInboundMessage(
    {
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      contactId: input.contactId,
      contactPhone: input.contactPhone,
      messageContent: input.messageContent,
      messageContentType: input.messageContentType,
      traceId: input.traceId,
    },
    {
      automationDidReply,
      sendMessage: async (_convId, text) => {
        pushReply(replies, text);
      },
    }
  );

  await logOrchestration({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    event: "orchestrator_result",
    decision: orchestratorResult.decision,
    reason: orchestratorResult.reason,
    traceId: input.traceId,
    stage: "orchestrator.exit",
    decisionCode: orchestratorResult.didReply
      ? "ORCHESTRATOR_REPLIED"
      : orchestratorResult.silence
        ? "ORCHESTRATOR_SILENCE"
        : "ORCHESTRATOR_NO_REPLY",
    durationMs: Date.now() - orchestratorStartedAt,
    metadata: {
      didReply: orchestratorResult.didReply,
      silence: orchestratorResult.silence,
    },
  });

  return {
    mode: "processed",
    replies,
    automationDidReply,
    orchestratorDidReply: orchestratorResult.didReply,
    orchestratorDecision: orchestratorResult.decision,
    orchestratorReason: orchestratorResult.reason,
    silence: !!orchestratorResult.silence,
  };
}
