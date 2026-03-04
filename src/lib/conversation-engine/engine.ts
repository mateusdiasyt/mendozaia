import { and, desc, eq } from "drizzle-orm";
import { processMessageReceivedRules } from "@/lib/automation/engine";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { processInboundMessage } from "@/lib/orchestration";
import { logOrchestration } from "@/lib/orchestration/logger";
import type { ConversationEngineInput, ConversationEngineResult } from "./types";

const INBOUND_DEBOUNCE_DEFAULT_MS = 6000;
const INBOUND_DEBOUNCE_SHORT_BURST_MS = 8000;
const INBOUND_DEBOUNCE_CLEAR_INTENT_MS = 4500;
/** Considera "digitando" se o último presence foi há menos que isso (presence pode ser esparso) */
const CONTACT_TYPING_IDLE_WAIT_MS = 5_000;
const CONTACT_TYPING_POLL_MS = 600;
/** Máximo de espera quando contato está digitando (evita delay excessivo) */
const CONTACT_TYPING_MAX_PAUSE_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeShortBurstMessage(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  if (t.length <= 8) return true;
  return /^(oi|ola|e ai|eai|opa|beleza|blz|bom dia|boa tarde|boa noite|ein|ok)$/.test(t);
}

function looksLikeClearIntentMessage(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  if (t.length >= 70) return true;
  return (
    /\b(problema|barulho|fumaca|fumaca|orcamento|revisao|agendar|agendamento|reserva)\b/.test(t) ||
    /\b(modelo|ano|km|quilometragem)\b/.test(t)
  );
}

function getInboundDebounceMs(messageContent: string): number {
  if (looksLikeShortBurstMessage(messageContent)) {
    return INBOUND_DEBOUNCE_SHORT_BURST_MS;
  }
  if (looksLikeClearIntentMessage(messageContent)) {
    return INBOUND_DEBOUNCE_CLEAR_INTENT_MS;
  }
  return INBOUND_DEBOUNCE_DEFAULT_MS;
}

function pushReply(replies: string[], text: string): void {
  const normalized = text.trim();
  if (!normalized) return;
  const lastReply = replies[replies.length - 1];
  if (lastReply === normalized) return;
  replies.push(normalized);
}

function isRecentTyping(typingAt: Date | null | undefined): boolean {
  if (!typingAt) return false;
  return Date.now() - new Date(typingAt).getTime() < CONTACT_TYPING_IDLE_WAIT_MS;
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
    // 1. PRIMEIRO: aguardar contato parar de digitar (evita interromper enquanto está escrevendo)
    let typingPauseElapsedMs = 0;
    let [conversationTypingState] = await db
      .select({ contactTypingAt: conversations.contactTypingAt })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);

    if (isRecentTyping(conversationTypingState?.contactTypingAt ?? null)) {
      await logOrchestration({
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        event: "conversation_engine_typing_pause",
        decision: "tool_then_ai",
        reason: "Contato digitando; aguardando inatividade antes de processar",
        traceId: input.traceId,
        stage: "conversation_engine.typing_pause",
        decisionCode: "ENGINE_TYPING_PAUSE",
        metadata: {
          idleWaitMs: CONTACT_TYPING_IDLE_WAIT_MS,
          maxPauseMs: CONTACT_TYPING_MAX_PAUSE_MS,
        },
      });
      while (
        typingPauseElapsedMs < CONTACT_TYPING_MAX_PAUSE_MS &&
        isRecentTyping(conversationTypingState?.contactTypingAt ?? null)
      ) {
        await sleep(CONTACT_TYPING_POLL_MS);
        typingPauseElapsedMs += CONTACT_TYPING_POLL_MS;
        [conversationTypingState] = await db
          .select({ contactTypingAt: conversations.contactTypingAt })
          .from(conversations)
          .where(eq(conversations.id, input.conversationId))
          .limit(1);
      }

      const [latestInboundAfterTypingWait] = await db
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
        latestInboundAfterTypingWait?.id &&
        latestInboundAfterTypingWait.id !== input.inboundMessageId
      ) {
        await logOrchestration({
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          event: "conversation_engine_debounced",
          decision: "tool_then_ai",
          reason: "Nova mensagem inbound durante espera de digitação",
          traceId: input.traceId,
          stage: "conversation_engine.typing_pause",
          decisionCode: "ENGINE_DEBOUNCED_TYPING",
          metadata: { pauseElapsedMs: typingPauseElapsedMs },
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

    // 2. DEPOIS: debounce para capturar mensagens em sequência
    const debounceMs = getInboundDebounceMs(input.messageContent);
    await sleep(debounceMs);
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
        metadata: { debounceMs },
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
