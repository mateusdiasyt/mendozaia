import { and, desc, eq, gt, asc, gte, isNull } from "drizzle-orm";
import { processMessageReceivedRules } from "@/lib/automation/engine";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { processInboundMessage, handoffToHuman } from "@/lib/orchestration";
import { logOrchestration } from "@/lib/orchestration/logger";
import { getUserMemory, updateUserMemory } from "@/lib/user-memory";
import {
  getCustomerProfile,
  updateCustomerProfile,
} from "@/lib/customer-profile";
import { getConversationMemory } from "@/lib/conversation-memory";
import { logIntelligence } from "@/lib/intelligence-logger";
import { classifyIntent } from "./intent-classifier";
import { detectFrustration } from "./frustration-detector";
import { detectUrgency } from "./urgency-detector";
import { isLoopConfusion } from "./loop-prevention";
import { calculateFromProfile } from "./priority-calculator";
import type { ConversationEngineInput, ConversationEngineResult } from "./types";
import { parseMessagesResponse, splitIntoMessages } from "./multi-message";
import {
  getLastUsedExampleIds,
  clearLastUsedExampleIds,
  decreaseQualityForUsedExamples,
  isNegativeFeedback,
} from "@/lib/ai-training";
import {
  getLastUsedFaqId,
  clearLastUsedFaqId,
  updateFaqConfidence,
} from "@/lib/faq-engine";
import {
  extractSlotsFromMessages,
  mergeVehicleSlots,
  type VehicleSlots,
} from "@/lib/orchestration/slot-extractor";
import { saveContactMemory } from "@/lib/contact-memories";

/** Debounce do buffer: aguarda N ms sem novas mensagens antes de processar (agrupa sequência) */
const MESSAGE_BUFFER_DEBOUNCE_MS = 2000;
const MESSAGE_BUFFER_MAX_CHARS = 2000;
/** Considera "digitando" se o último presence foi há menos que isso (presence pode ser esparso) */
const CONTACT_TYPING_IDLE_WAIT_MS = 5_000;
const CONTACT_TYPING_POLL_MS = 600;
/** Máximo de espera quando contato está digitando (evita delay excessivo) */
const CONTACT_TYPING_MAX_PAUSE_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function toTimeStr(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function extractPassiveTime(text: string): { hour: number; minute: number } | null {
  const withColon = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (withColon) {
    const hour = Number(withColon[1]);
    const minute = Number(withColon[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const withH = text.match(/\b(\d{1,2})h(?:\s*(\d{2}))?\b/i);
  if (withH) {
    const hour = Number(withH[1]);
    const minute = Number(withH[2] ?? "0");
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
}

function extractPassiveDate(text: string, now: Date): { dateStr: string } | null {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return { dateStr: `${iso[1]}-${iso[2]}-${iso[3]}` };
  }

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = Number(slash[3] ?? now.getFullYear());
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { dateStr: toDateStr(year, month, day) };
    }
  }

  if (/\bamanha\b/.test(normalized)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { dateStr: toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate()) };
  }

  if (/\bhoje\b/.test(normalized)) {
    return { dateStr: toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate()) };
  }

  return null;
}

async function persistSignalsWhenAiPaused(
  input: ConversationEngineInput
): Promise<{ vehicleUpdated: boolean; reservationUpdated: boolean }> {
  if (input.messageContentType !== "text" || !input.messageContent.trim()) {
    return { vehicleUpdated: false, reservationUpdated: false };
  }

  const [convRow, inboundRows] = await Promise.all([
    db
      .select({
        metadata: conversations.conversationStateMetadata,
      })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1),
    db
      .select({
        direction: messages.direction,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.conversationId, input.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(12),
  ]);

  const metadata = (convRow?.[0]?.metadata as Record<string, unknown> | undefined) ?? {};
  const existingVehicleSlots =
    (metadata.vehicleSlots as VehicleSlots | undefined) ?? {};
  const extractedVehicle = extractSlotsFromMessages([...inboundRows].reverse());
  const mergedVehicle = mergeVehicleSlots(existingVehicleSlots, extractedVehicle);
  const vehicleUpdated =
    JSON.stringify(mergedVehicle) !== JSON.stringify(existingVehicleSlots);

  if (mergedVehicle.modelo) {
    await saveContactMemory(input.contactId, "vehicle_model", mergedVehicle.modelo);
  }
  if (mergedVehicle.ano) {
    await saveContactMemory(input.contactId, "vehicle_year", String(mergedVehicle.ano));
  }
  if (mergedVehicle.km) {
    await saveContactMemory(input.contactId, "vehicle_km", String(mergedVehicle.km));
  }

  const inboundTexts = inboundRows
    .filter((row) => row.direction === "inbound" && !!row.content?.trim())
    .map((row) => row.content!.trim());
  const now = new Date();
  let foundDate: string | null = null;
  let foundTime: string | null = null;

  for (let i = 0; i < inboundTexts.length; i++) {
    const head = inboundTexts[i]!;
    const candidates = [head];
    if (i + 1 < inboundTexts.length) candidates.push(`${inboundTexts[i + 1]} ${head}`);
    if (i + 2 < inboundTexts.length) {
      candidates.push(`${inboundTexts[i + 2]} ${inboundTexts[i + 1]} ${head}`);
    }
    for (const candidate of candidates) {
      if (!foundDate) {
        const parsedDate = extractPassiveDate(candidate, now);
        if (parsedDate?.dateStr) foundDate = parsedDate.dateStr;
      }
      if (!foundTime) {
        const parsedTime = extractPassiveTime(candidate);
        if (parsedTime) foundTime = toTimeStr(parsedTime.hour, parsedTime.minute);
      }
      if (foundDate && foundTime) break;
    }
    if (foundDate && foundTime) break;
  }

  const pendingReservation =
    (metadata.pendingReservation as Record<string, unknown> | undefined) ?? {};
  const reservationPeriodFlow =
    (metadata.reservationPeriodFlow as Record<string, unknown> | undefined) ?? {};

  const nextPending = {
    ...pendingReservation,
    dateStr:
      typeof pendingReservation.dateStr === "string"
        ? pendingReservation.dateStr
        : foundDate ?? undefined,
    timeStr:
      typeof pendingReservation.timeStr === "string"
        ? pendingReservation.timeStr
        : foundTime ?? undefined,
    durationMinutes:
      typeof pendingReservation.durationMinutes === "number"
        ? pendingReservation.durationMinutes
        : 60,
  };

  const nextPeriod = {
    ...reservationPeriodFlow,
    dateStr:
      typeof reservationPeriodFlow.dateStr === "string"
        ? reservationPeriodFlow.dateStr
        : foundDate ?? undefined,
  };

  const reservationUpdated = Boolean(
    (foundDate && !pendingReservation.dateStr && !reservationPeriodFlow.dateStr) ||
      (foundTime && !pendingReservation.timeStr)
  );

  if (vehicleUpdated || reservationUpdated) {
    await db
      .update(conversations)
      .set({
        conversationStateMetadata: {
          ...metadata,
          vehicleSlots: mergedVehicle,
          vehicleSlotsUpdatedAt: new Date().toISOString(),
          pendingReservation: nextPending,
          reservationPeriodFlow: nextPeriod,
        },
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, input.conversationId));
  }

  return { vehicleUpdated, reservationUpdated };
}

function pushReply(replies: string[], text: string): void {
  const normalized = text.trim();
  if (!normalized) return;

  const parsed = parseMessagesResponse(normalized);
  const parts = parsed ?? (normalized.length > 120 ? splitIntoMessages(normalized) : [normalized]);

  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const lastReply = replies[replies.length - 1];
    if (lastReply === p) continue;
    replies.push(p);
  }
}

/** Busca e combina todas as mensagens inbound desde o último outbound (buffer da sequência do usuário). */
async function fetchCombinedInboundContent(
  conversationId: string,
  contentType: string
): Promise<string> {
  const [lastOutbound] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const since = lastOutbound?.createdAt ?? new Date(0);
  const inboundRows = await db
    .select({ content: messages.content, contentType: messages.contentType })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "inbound"),
        gt(messages.createdAt, since)
      )
    )
    .orderBy(asc(messages.createdAt))
    .limit(20);

  const parts = inboundRows
    .filter((m) => m.contentType === "text" && m.content?.trim())
    .map((m) => (m.content ?? "").trim());
  const combined = parts.join(" ").replace(/\s+/g, " ").trim();
  return combined.length > MESSAGE_BUFFER_MAX_CHARS
    ? combined.slice(-MESSAGE_BUFFER_MAX_CHARS)
    : combined;
}

/** Últimos 45 segundos para agregação de mensagens quebradas */
const COMBINED_CONTENT_WINDOW_SECONDS = 45;

/** Máximo de mensagens inbound a agregar para a IA */
const COMBINED_CONTENT_MAX_MESSAGES = 8;

/** Resultado da agregação de mensagens dos últimos 30s */
interface CombinedContentResult {
  combined: string;
  messageIds: string[];
}

/** Busca e combina mensagens inbound dos últimos 45s (não processadas). Usado pelo debouncer. */
async function fetchCombinedInboundContentLast45s(
  conversationId: string,
  _contentType: string
): Promise<CombinedContentResult> {
  const since = new Date(Date.now() - COMBINED_CONTENT_WINDOW_SECONDS * 1000);

  const inboundRows = await db
    .select({
      content: messages.content,
      contentType: messages.contentType,
      id: messages.id,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "inbound"),
        gte(messages.createdAt, since),
        isNull(messages.processedAt)
      )
    )
    .orderBy(asc(messages.createdAt))
    .limit(50);

  const textRows = inboundRows.filter(
    (m) => m.contentType === "text" && m.content?.trim()
  );
  const limitedRows = textRows.slice(-COMBINED_CONTENT_MAX_MESSAGES);
  const parts = limitedRows.map((m) => (m.content ?? "").trim());
  const combined = parts.join(" ").replace(/\s+/g, " ").trim();
  const finalCombined =
    combined.length > MESSAGE_BUFFER_MAX_CHARS
      ? combined.slice(-MESSAGE_BUFFER_MAX_CHARS)
      : combined;
  const messageIds = limitedRows.map((m) => m.id).filter(Boolean);

  return { combined: finalCombined, messageIds };
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
    input.conversationState === "human_active" ||
    input.isPriority === true;

  if (isAiPaused || isHumanOnlyState) {
    const passiveCapture = isAiPaused
      ? await persistSignalsWhenAiPaused(input)
      : { vehicleUpdated: false, reservationUpdated: false };

    await logOrchestration({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      event: "conversation_engine_skipped",
      decision: "human_only",
      reason: isAiPaused
        ? "IA pausada no contato; engine não executa automação/orquestrador"
        : "Conversa em coluna/estado humano-prioritário; engine não executa automação/orquestrador",
      traceId: input.traceId,
      stage: "conversation_engine.guard",
      decisionCode: "ENGINE_SKIP_AUTOMATION_ORCHESTRATOR",
      metadata: {
        aiDisabledUntil: input.aiDisabledUntil
          ? input.aiDisabledUntil.toISOString()
          : null,
        conversationState: input.conversationState ?? null,
        passiveVehicleUpdated: passiveCapture.vehicleUpdated,
        passiveReservationUpdated: passiveCapture.reservationUpdated,
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

  // Parte 8 (exemplos) + FAQ: se cliente disse "não entendi" / "isso não ajudou", diminuir score
  if (input.messageContent.trim() && isNegativeFeedback(input.messageContent)) {
    const lastFaqId = await getLastUsedFaqId(input.conversationId);
    if (lastFaqId) {
      await updateFaqConfidence(lastFaqId, -10);
      await clearLastUsedFaqId(input.conversationId);
    } else {
      const usedIds = await getLastUsedExampleIds(input.conversationId);
      if (usedIds.length > 0) {
        await decreaseQualityForUsedExamples(usedIds, -15);
        await clearLastUsedExampleIds(input.conversationId);
      }
    }
  }

  // Memória do usuário (Redis)
  const userMemory = await getUserMemory(input.contactPhone);
  console.log({
    stage: "user_memory_loaded",
    conversationId: input.conversationId,
    hasMemory: !!userMemory,
  });

  // Perfil do cliente (Redis) - Parte 1
  const customerProfile = await getCustomerProfile(input.contactPhone);
  logIntelligence({
    event: "customer_profile_loaded",
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    metadata: { hasProfile: !!customerProfile },
  });

  // Memória de conversa anterior - Parte 3
  const conversationMemory = await getConversationMemory(input.conversationId);
  logIntelligence({
    event: "conversation_memory_loaded",
    conversationId: input.conversationId,
    metadata: { hasMemory: !!conversationMemory },
  });

  const customerContext =
    customerProfile || conversationMemory
      ? {
          name: customerProfile?.name,
          lastIntent: customerProfile?.lastIntent ?? userMemory?.lastIntent,
          preferredTopic:
            customerProfile?.preferredTopic ?? conversationMemory?.mainTopic,
          keyFacts: conversationMemory?.keyFacts,
        }
      : undefined;

  // Detecção de urgência - Parte 6
  const isUrgent = detectUrgency(input.messageContent);
  if (isUrgent) {
    logIntelligence({
      event: "urgency_detected",
      conversationId: input.conversationId,
      organizationId: input.organizationId,
    });
    pushReply(
      replies,
      "Entendi que é urgente. Vou tentar te ajudar o mais rápido possível."
    );
  }

  // Prevenção de loop - Parte 8: bot 3x + "não entendi" → handoff
  if (isLoopConfusion(input.messageContent)) {
    const lastMessages = await db
      .select({ direction: messages.direction })
      .from(messages)
      .where(eq(messages.conversationId, input.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(4);
    let consecutiveOutbound = 0;
    for (let i = 1; i < lastMessages.length; i++) {
      if (lastMessages[i]?.direction === "outbound") consecutiveOutbound++;
      else break;
    }
    if (consecutiveOutbound >= 3) {
      const { priorityScore } = calculateFromProfile(customerProfile);
      await handoffToHuman(
        input.conversationId,
        input.organizationId,
        "Loop de confusão detectado (bot 3x + não entendi)",
        {
          priorityScore: Math.max(5, priorityScore),
          urgency: "normal",
          conversationSummary: {
            summary: `Cliente disse "não entendi" após 3+ respostas do bot. Transferido para humano.`,
            mainTopic: userMemory?.lastTopic ?? "confusão",
            keyFacts: [],
          },
        }
      );
      await updateCustomerProfile(input.contactPhone, {
        lastSeenAt: new Date().toISOString(),
        totalMessages: (customerProfile?.totalMessages ?? 0) + 1,
      });
      replies.push(
        "Vou chamar um atendente humano para te ajudar melhor. Um momento 🙏"
      );
      return {
        mode: "escalated",
        replies,
        automationDidReply: false,
        orchestratorDidReply: true,
        silence: false,
        escalated: true,
      };
    }
  }

  // Classificação de intenção
  const intent = classifyIntent(input.messageContent);
  if (intent) {
    console.log({
      stage: "intent_detected",
      conversationId: input.conversationId,
      intent,
    });
  }

  if (intent === "PEDIR_ATENDENTE") {
    const { priorityScore } = calculateFromProfile(customerProfile);
    await handoffToHuman(
      input.conversationId,
      input.organizationId,
      "Cliente pediu atendente humano",
      {
        priorityScore: Math.max(5, priorityScore),
        urgency: isUrgent ? "high" : "normal",
        conversationSummary: {
          summary: `Cliente ${customerProfile?.name ?? "anon"} pediu atendente humano.`,
          mainTopic: "pedir_atendente",
          keyFacts: conversationMemory?.keyFacts ?? [],
        },
      }
    );
    await updateUserMemory(input.contactPhone, {
      lastIntent: intent,
      lastTopic: "pedir_atendente",
      lastInteractionAt: new Date().toISOString(),
    });
    await updateCustomerProfile(input.contactPhone, {
      lastSeenAt: new Date().toISOString(),
      totalMessages: (customerProfile?.totalMessages ?? 0) + 1,
      lastIntent: intent,
      preferredTopic: "pedir_atendente",
    });
    console.log({
      stage: "conversation_escalated",
      conversationId: input.conversationId,
      reason: "PEDIR_ATENDENTE",
    });
    replies.push(
      "Vou chamar um atendente humano para te ajudar melhor. Um momento 🙏"
    );
    return {
      mode: "escalated",
      replies,
      automationDidReply: false,
      orchestratorDidReply: true,
      silence: false,
      escalated: true,
    };
  }

  // Detecção de frustração
  const isFrustrated = detectFrustration(input.messageContent);
  if (isFrustrated) {
    const newScore = (userMemory?.frustrationScore ?? 0) + 1;
    await updateUserMemory(input.contactPhone, {
      frustrationScore: newScore,
      lastIntent: intent ?? userMemory?.lastIntent,
      lastTopic: userMemory?.lastTopic,
      lastInteractionAt: new Date().toISOString(),
    });
    console.log({
      stage: "frustration_detected",
      conversationId: input.conversationId,
      frustrationScore: newScore,
    });

    if (newScore >= 2) {
      const { priorityScore } = calculateFromProfile(customerProfile);
      await handoffToHuman(
        input.conversationId,
        input.organizationId,
        "Frustração detectada (score >= 2)",
        {
          priorityScore: Math.max(5, priorityScore + 2),
          urgency: isUrgent ? "high" : "normal",
          conversationSummary: {
            summary: `Cliente ${customerProfile?.name ?? "anon"} frustrado (score ${newScore}). Transferido para humano.`,
            mainTopic: userMemory?.lastTopic ?? "frustração",
            keyFacts: conversationMemory?.keyFacts ?? [],
          },
        }
      );
      await updateCustomerProfile(input.contactPhone, {
        lastSeenAt: new Date().toISOString(),
        totalMessages: (customerProfile?.totalMessages ?? 0) + 1,
        frustrationScore: newScore,
        lastIntent: intent ?? customerProfile?.lastIntent,
      });
      console.log({
        stage: "conversation_escalated",
        conversationId: input.conversationId,
        reason: "frustration_threshold",
      });
      replies.push(
        "Vou chamar um atendente humano para te ajudar melhor. Um momento 🙏"
      );
      return {
        mode: "escalated",
        replies,
        automationDidReply: false,
        orchestratorDidReply: true,
        silence: false,
        escalated: true,
      };
    }
  }

  // Atualizar memória com intenção/tópico
  if (intent) {
    await updateUserMemory(input.contactPhone, {
      lastIntent: intent,
      lastTopic: intent.toLowerCase(),
      lastInteractionAt: new Date().toISOString(),
    });
    console.log({
      stage: "user_memory_updated",
      conversationId: input.conversationId,
      lastIntent: intent,
    });
  }

  if (
    !input.skipBufferAndTypingWait &&
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

    // 2. BUFFER + DEBOUNCE: aguarda N ms sem novas mensagens para agrupar sequência
    await sleep(MESSAGE_BUFFER_DEBOUNCE_MS);
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
        reason: "Nova mensagem inbound durante buffer; webhook mais recente processará",
        traceId: input.traceId,
        stage: "conversation_engine.buffer",
        decisionCode: "ENGINE_DEBOUNCED",
        metadata: { debounceMs: MESSAGE_BUFFER_DEBOUNCE_MS },
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

  // 3. Contexto a processar: buffer combinado ou mensagem original
  let messageContentToProcess = input.messageContent;
  let processedMessageIds: string[] = [];
  if (
    input.messageContentType === "text" &&
    input.messageContent.trim() &&
    input.inboundMessageId
  ) {
    if (input.skipBufferAndTypingWait) {
      const result = await fetchCombinedInboundContentLast45s(
        input.conversationId,
        input.messageContentType
      );
      processedMessageIds = result.messageIds;
      if (result.combined && result.combined !== input.messageContent.trim()) {
        messageContentToProcess = result.combined;
        await logOrchestration({
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          event: "conversation_engine_buffer_combined",
          decision: "tool_then_ai",
          reason: "Buffer: mensagens dos últimos 30s combinadas",
          traceId: input.traceId,
          stage: "conversation_engine.buffer",
          decisionCode: "ENGINE_BUFFER_COMBINED",
          metadata: {
            originalLength: input.messageContent.length,
            combinedLength: result.combined.length,
            window: "30s",
            messageCount: processedMessageIds.length,
          },
        });
      }
    } else {
      const combined = await fetchCombinedInboundContent(
        input.conversationId,
        input.messageContentType
      );
      if (combined && combined !== input.messageContent.trim()) {
        messageContentToProcess = combined;
        await logOrchestration({
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          event: "conversation_engine_buffer_combined",
          decision: "tool_then_ai",
          reason: "Buffer: múltiplas mensagens combinadas para processamento",
          traceId: input.traceId,
          stage: "conversation_engine.buffer",
          decisionCode: "ENGINE_BUFFER_COMBINED",
          metadata: {
            originalLength: input.messageContent.length,
            combinedLength: combined.length,
            window: "last_outbound",
          },
        });
      }
    }
  }

  const automationStartedAt = Date.now();
  const { didReply: automationDidReply } = await processMessageReceivedRules(
    {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      contactPhone: input.contactPhone,
      messageContent: messageContentToProcess,
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
      messageContent: messageContentToProcess,
      messageContentType: input.messageContentType,
      traceId: input.traceId,
      customerContext: customerContext ?? undefined,
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

  // processedAt é marcado pelo debouncer apenas após envio bem-sucedido (evita marcar sem responder)

  // Atualizar perfil do cliente - Parte 1
  const isNewProfile = !customerProfile;
  await updateCustomerProfile(input.contactPhone, {
    name: customerProfile?.name ?? userMemory?.name,
    lastSeenAt: new Date().toISOString(),
    totalMessages: (customerProfile?.totalMessages ?? 0) + 1,
    totalConversations: isNewProfile ? 1 : (customerProfile?.totalConversations ?? 1),
    firstSeenAt: isNewProfile ? new Date().toISOString() : undefined,
    lastIntent: intent ?? customerProfile?.lastIntent,
    preferredTopic: intent?.toLowerCase() ?? customerProfile?.preferredTopic,
    frustrationScore:
      userMemory?.frustrationScore ?? customerProfile?.frustrationScore ?? 0,
  });
  logIntelligence({
    event: "customer_profile_updated",
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    metadata: { totalMessages: (customerProfile?.totalMessages ?? 0) + 1 },
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
