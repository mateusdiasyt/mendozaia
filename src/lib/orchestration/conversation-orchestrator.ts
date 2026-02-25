/**
 * Orquestrador de conversa - camada central que controla o fluxo.
 * A IA nunca responde diretamente ao webhook sem passar por aqui.
 */

import { db } from "@/lib/db";
import { conversations, organizations, messages } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { logOrchestration } from "./logger";
import { filterResponse } from "./response-filter";
import { handoffToHuman } from "./handoff";
import { generateAIReply } from "@/lib/ai-agent";
import { checkAvailabilityForOrg } from "@/lib/reservations";
import {
  extractSlotsFromMessages,
  mergeVehicleSlots,
  hasAllVehicleSlots,
  type VehicleSlots,
} from "./slot-extractor";
import type {
  OrchestrationContext,
  OrchestratorResult,
  OrchestratorDecision,
} from "./types";
import { CONVERSATION_STATES } from "./types";

export interface ProcessInboundMessageParams {
  conversationId: string;
  organizationId: string;
  contactId: string;
  contactPhone: string;
  messageContent: string;
  messageContentType?: string;
}

export interface ProcessResult {
  didReply: boolean;
  decision: OrchestratorDecision;
  reason: string;
  silence: boolean;
}

function looksLikeFallbackReservationReply(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("nossa equipe vai verificar") ||
    t.includes("retornar em breve") ||
    t.includes("vou consultar") && t.includes("retorno") ||
    t.includes("retorno com uma posição")
  );
}

function containsDateOrTimeHint(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b\d{1,2}[:h]\d{0,2}\b/.test(t) ||
    /\b(hoje|amanh[ãa]|dia\s+\d{1,2})\b/.test(t) ||
    /\b(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(t) ||
    /\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/.test(t)
  );
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

function extractTime(text: string): { hour: number; minute: number } | null {
  const timeWithColon = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (timeWithColon) {
    const hour = Number(timeWithColon[1]);
    const minute = Number(timeWithColon[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const timeWithH = text.match(/\b(\d{1,2})h(?:\s*(\d{2}))?\b/i);
  if (timeWithH) {
    const hour = Number(timeWithH[1]);
    const minute = Number(timeWithH[2] ?? "0");
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const timeWithAs = text.match(/\b(?:às?|as)\s*(\d{1,2})(?::(\d{2}))?\s*h?\b/i);
  if (timeWithAs) {
    const hour = Number(timeWithAs[1]);
    const minute = Number(timeWithAs[2] ?? "0");
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
}

function extractDate(text: string, now: Date): { year: number; month: number; day: number } | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = Number(slash[3] ?? now.getFullYear());
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }

  if (/\bamanh[ãa]\b/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  if (/\bhoje\b/i.test(text)) {
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  const monthMap: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    março: 3,
    marco: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };
  const monthByName = text.match(
    /\b(?:dia\s+)?(\d{1,2})\s*(?:de)?\s*(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i
  );
  if (monthByName) {
    const day = Number(monthByName[1]);
    const month = monthMap[monthByName[2].toLowerCase()];
    let year = now.getFullYear();
    const tentative = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (tentative < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      year += 1;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }

  return null;
}

function extractReservationDateTime(
  text: string,
  now: Date = new Date()
): { dateStr: string; timeStr: string } | null {
  const date = extractDate(text, now);
  const time = extractTime(text);
  if (!date || !time) return null;
  return {
    dateStr: toDateStr(date.year, date.month, date.day),
    timeStr: toTimeStr(time.hour, time.minute),
  };
}

function formatDateForPtBr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function enforceReservationReply(ctx: OrchestrationContext, aiReply: string): string {
  if (!ctx.reservationsEnabled || !looksLikeFallbackReservationReply(aiReply)) {
    return aiReply;
  }

  if (ctx.usesVehicleSlots && ctx.vehicleSlots && hasAllVehicleSlots(ctx.vehicleSlots)) {
    if (containsDateOrTimeHint(ctx.messageContent)) {
      return "Perfeito, recebi sua data e horário. Vou consultar a disponibilidade agora.";
    }
    return "Posso consultar a disponibilidade e já reservar um horário para você. Qual data e horário prefere?";
  }

  return aiReply;
}

/** Carrega o contexto completo da conversa. */
export async function loadConversationContext(
  params: ProcessInboundMessageParams
): Promise<OrchestrationContext | null> {
  const [conv] = await db
    .select({
      aiDisabledUntil: conversations.aiDisabledUntil,
      conversationState: conversations.conversationState,
      handoffReason: conversations.handoffReason,
      isPriority: conversations.isPriority,
      assignedToId: conversations.assignedToId,
      conversationStateMetadata: conversations.conversationStateMetadata,
    })
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .limit(1);

  if (!conv) return null;

  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, params.organizationId))
    .limit(1);

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};
  const systemPrompt = (aiAgent.systemPrompt as string) ?? "";
  const usesVehicleSlots =
    /modelo|ano|quilometragem|veículo/i.test(systemPrompt) &&
    /agendamento|agendar|mecânica/i.test(systemPrompt);

  const metadata = (conv.conversationStateMetadata as Record<string, unknown>) ?? {};
  const existingSlots = metadata.vehicleSlots as VehicleSlots | undefined;

  let vehicleSlots = existingSlots;
  if (usesVehicleSlots) {
    // Buscar as 20 mensagens MAIS RECENTES (não as primeiras 20 da conversa)
    const recentDesc = await db
      .select({ direction: messages.direction, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, params.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    const recentRows = [...recentDesc].reverse(); // ordem cronológica para extração
    const extracted = extractSlotsFromMessages(recentRows);
    vehicleSlots = mergeVehicleSlots(existingSlots, extracted);

    if (
      (extracted.modelo || extracted.ano || extracted.km) &&
      JSON.stringify(vehicleSlots) !== JSON.stringify(existingSlots)
    ) {
      await db
        .update(conversations)
        .set({
          conversationStateMetadata: { ...metadata, vehicleSlots },
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, params.conversationId));
    }
  }

  return {
    conversationId: params.conversationId,
    organizationId: params.organizationId,
    contactId: params.contactId,
    contactPhone: params.contactPhone,
    messageContent: params.messageContent,
    messageContentType: params.messageContentType ?? "text",
    conversationState: conv.conversationState ?? CONVERSATION_STATES.INIT,
    aiDisabledUntil: conv.aiDisabledUntil ?? null,
    handoffReason: conv.handoffReason ?? null,
    isPriority: conv.isPriority ?? false,
    assignedToId: conv.assignedToId ?? null,
    reservationsEnabled: !!(settings.reservationsEnabled as boolean),
    aiAgentEnabled: !!(aiAgent.enabled as boolean),
    aiAgentUseAsFallback: aiAgent.useAsFallback !== false,
    vehicleSlots: usesVehicleSlots ? vehicleSlots : undefined,
    usesVehicleSlots,
  };
}

/** Decide a próxima ação com base no estado e regras de negócio. */
export function decideNextAction(ctx: OrchestrationContext): OrchestratorResult {
  const state = ctx.conversationState;
  const isAiPaused = ctx.aiDisabledUntil && ctx.aiDisabledUntil > new Date();

  if (state === CONVERSATION_STATES.WAITING_HUMAN || state === CONVERSATION_STATES.HUMAN_ACTIVE) {
    return {
      decision: "human_only",
      reason: "Conversa aguardando humano",
      shouldRespond: false,
      shouldCallAI: false,
    };
  }

  if (isAiPaused) {
    return {
      decision: "human_only",
      reason: "IA pausada manualmente",
      shouldRespond: false,
      shouldCallAI: false,
    };
  }

  if (state === CONVERSATION_STATES.CLOSED) {
    return {
      decision: "silence",
      reason: "Conversa encerrada",
      shouldRespond: false,
      shouldCallAI: false,
    };
  }

  if (!ctx.messageContent?.trim()) {
    return {
      decision: "silence",
      reason: "Mensagem vazia ou irrelevante",
      shouldRespond: false,
      shouldCallAI: false,
    };
  }

  if (ctx.messageContent.trim().length < 2) {
    return {
      decision: "silence",
      reason: "Mensagem muito curta (possível spam)",
      shouldRespond: false,
      shouldCallAI: false,
    };
  }

  if (!ctx.aiAgentEnabled || !ctx.aiAgentUseAsFallback) {
    return {
      decision: "automation_only",
      reason: "IA desativada ou não é fallback",
      shouldRespond: false,
      shouldCallAI: false,
    };
  }

  return {
    decision: ctx.reservationsEnabled ? "tool_then_ai" : "ai_respond",
    reason: "IA habilitada como fallback",
    shouldRespond: true,
    shouldCallAI: true,
  };
}

/** Chama a IA e retorna resposta filtrada. Retorna null se não devolver. */
export async function callAIWithContext(
  ctx: OrchestrationContext,
  sendMessage: (convId: string, text: string) => Promise<void>
): Promise<boolean> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, ctx.organizationId))
    .limit(1);

  const aiAgent = (org?.settings as Record<string, unknown>)?.aiAgent as Record<string, unknown> | undefined;
  const systemPrompt = (aiAgent?.systemPrompt as string) || undefined;
  const model = (aiAgent?.model as string) || "gemini-2.0-flash";
  const apiKey = (aiAgent?.apiKey as string) || undefined;

  try {
    const rawReply = await generateAIReply(
      ctx.conversationId,
      ctx.contactId,
      ctx.messageContent,
      systemPrompt ?? "",
      model,
      apiKey,
      {
        organizationId: ctx.organizationId,
        reservationsEnabled: ctx.reservationsEnabled,
        vehicleSlots: ctx.vehicleSlots,
        usesVehicleSlots: ctx.usesVehicleSlots,
      }
    );

    const guardedReply = enforceReservationReply(ctx, rawReply);
    const filtered = filterResponse(guardedReply);
    if (!filtered) {
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "ai_response_filtered",
        decision: "ai_respond",
        reason: "Resposta filtrada (vazia ou inválida)",
      });
      return false;
    }

    await sendMessage(ctx.conversationId, filtered);

    // Detecta handoff implícito na resposta (ex: template mecânica "direcionar para mecânico")
    const handoffPhrases = [
      "direcionar seu atendimento para um",
      "direcionar para um *mecânico técnico*",
      "mecânico técnico*, que dará continuidade",
      "vou direcionar seu atendimento",
    ];
    const triggersHandoff = handoffPhrases.some((p) =>
      filtered.toLowerCase().includes(p.toLowerCase())
    );
    if (triggersHandoff) {
      await handoffToHuman(ctx.conversationId, ctx.organizationId, "Resposta da IA solicitou handoff");
    }

    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "ai_responded",
      decision: "ai_respond",
      reason: "Resposta enviada",
      metadata: { length: filtered.length, handoffTriggered: triggersHandoff },
    });
    return true;
  } catch (err) {
    console.error("[orchestrator] AI call failed:", err);
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "ai_error",
      decision: "ai_respond",
      reason: "Falha ao chamar IA",
      metadata: { error: String(err) },
    });
    return false;
  }
}

/**
 * Processa mensagem inbound: carrega estado, decide ação, chama IA se permitido.
 * Retorna se houve resposta (incluindo automação).
 */
export async function processInboundMessage(
  params: ProcessInboundMessageParams,
  options: {
    automationDidReply: boolean;
    sendMessage: (convId: string, text: string) => Promise<void>;
  }
): Promise<ProcessResult> {
  const ctx = await loadConversationContext(params);
  if (!ctx) {
    return { didReply: options.automationDidReply, decision: "silence", reason: "Contexto não encontrado", silence: true };
  }

  const result = decideNextAction(ctx);

  await logOrchestration({
    conversationId: params.conversationId,
    organizationId: params.organizationId,
    event: "decision",
    stateBefore: ctx.conversationState,
    decision: result.decision,
    reason: result.reason,
  });

  if (options.automationDidReply) {
    return { didReply: true, decision: "automation_only", reason: "Automação respondeu", silence: false };
  }

  if (!result.shouldCallAI) {
    return {
      didReply: false,
      decision: result.decision,
      reason: result.reason,
      silence: !result.shouldRespond,
    };
  }

  // Caminho determinístico: se o cliente já informou veículo + data/hora,
  // consulta disponibilidade direto no sistema de reservas (sem depender da IA).
  if (
    ctx.reservationsEnabled &&
    ctx.usesVehicleSlots &&
    ctx.vehicleSlots &&
    hasAllVehicleSlots(ctx.vehicleSlots)
  ) {
    const parsed = extractReservationDateTime(ctx.messageContent);
    if (parsed) {
      const availability = await checkAvailabilityForOrg(
        ctx.organizationId,
        parsed.dateStr,
        parsed.timeStr,
        60
      );
      const friendlyDate = formatDateForPtBr(parsed.dateStr);
      const reply = availability.available
        ? `Temos disponibilidade em ${friendlyDate} às ${parsed.timeStr}. Deseja que eu confirme a reserva para você?`
        : `Não há disponibilidade em ${friendlyDate} às ${parsed.timeStr}. Se quiser, me diga outro dia e horário que eu consulto agora.`;

      await options.sendMessage(ctx.conversationId, reply);
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_auto_check",
        decision: "tool_then_ai",
        reason: "Disponibilidade consultada automaticamente pelo orquestrador",
        metadata: {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          available: availability.available,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Disponibilidade consultada automaticamente",
        silence: false,
      };
    }
  }

  const aiReplied = await callAIWithContext(ctx, options.sendMessage);
  return {
    didReply: aiReplied,
    decision: result.decision,
    reason: result.reason,
    silence: false,
  };
}
