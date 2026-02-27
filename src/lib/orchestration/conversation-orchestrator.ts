/**
 * Orquestrador de conversa - camada central que controla o fluxo.
 * A IA nunca responde diretamente ao webhook sem passar por aqui.
 */

import { db } from "@/lib/db";
import { conversations, organizations, messages, contacts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { logOrchestration } from "./logger";
import { filterResponse } from "./response-filter";
import { handoffToHuman } from "./handoff";
import { generateAIReply } from "@/lib/ai-agent";
import { checkAvailabilityForOrg, createReservationForOrg } from "@/lib/reservations";
import {
  extractSlotsFromMessages,
  mergeVehicleSlots,
  hasAllVehicleSlots,
  getMissingSlots,
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
  traceId?: string;
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

  // Ex.: "dia 26 as 14h" (sem mês explícito) -> assume mês atual, ou próximo mês se já passou
  const dayOnly = text.match(/\bdia\s+(\d{1,2})\b/i);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (day >= 1 && day <= 31) {
      let year = now.getFullYear();
      let month = now.getMonth() + 1;
      const tentative = new Date(year, month - 1, day, 0, 0, 0, 0);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (tentative < today) {
        const nextMonthBase = new Date(year, month, 1);
        year = nextMonthBase.getFullYear();
        month = nextMonthBase.getMonth() + 1;
      }
      return { year, month, day };
    }
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

function looksLikeVehicleInfoMessage(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(modelo|ano|km|quilometragem|ve[ií]culo)\b/.test(t) ||
    /\b\d{4}\b/.test(t) ||
    /\b\d{1,3}\s*mil\s*km\b/.test(t)
  );
}

async function findLatestInboundReservationDateTime(
  conversationId: string
): Promise<{ dateStr: string; timeStr: string } | null> {
  const recent = await db
    .select({ direction: messages.direction, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(20);

  for (const row of recent) {
    if (row.direction !== "inbound" || !row.content?.trim()) continue;
    const parsed = extractReservationDateTime(row.content);
    if (parsed) return parsed;
  }

  return null;
}

function formatDateForPtBr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function buildMissingVehicleInfoReply(missing: ("modelo" | "ano" | "km")[]): string {
  if (missing.length === 0) {
    return "Perfeito. Para seguir com o agendamento, me diga a data e o horário que prefere.";
  }

  if (missing.length === 1) {
    const only = missing[0];
    if (only === "km") {
      return "Perfeito. Para consultar o agendamento, só falta a *quilometragem* do veículo.";
    }
    if (only === "ano") {
      return "Perfeito. Para consultar o agendamento, só falta o *ano* do veículo.";
    }
    return "Perfeito. Para consultar o agendamento, só falta o *modelo* do veículo.";
  }

  if (missing.length === 2) {
    const labels = missing.map((m) =>
      m === "km" ? "quilometragem" : m
    );
    return `Perfeito. Para consultar o agendamento, preciso de *${labels[0]}* e *${labels[1]}* do veículo.`;
  }

  return "Para eu consultar a disponibilidade e já te ajudar com a reserva, me informe *modelo, ano e quilometragem* do veículo.";
}

function buildAvailabilityReply(parsed: { dateStr: string; timeStr: string }, available: boolean): string {
  const friendlyDate = formatDateForPtBr(parsed.dateStr);
  return available
    ? `Temos disponibilidade em ${friendlyDate} às ${parsed.timeStr}. Deseja que eu confirme a reserva para você?`
    : `Não há disponibilidade em ${friendlyDate} às ${parsed.timeStr}. Se quiser, me diga outro dia e horário que eu consulto agora.`;
}

function extractCustomerName(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (containsDateOrTimeHint(lower) || looksLikeReservationConfirmation(lower)) return null;

  const explicit = trimmed.match(/\b(?:meu nome é|me chamo|sou o|sou a)\s+([a-zà-ú' ]{2,40})$/i);
  if (explicit?.[1]) {
    const name = explicit[1].replace(/\s+/g, " ").trim();
    return name.length >= 2 ? name : null;
  }

  if (/^[a-zà-ú' ]{2,40}$/i.test(trimmed) && trimmed.split(/\s+/).length <= 3) {
    const normalized = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["sim", "ok", "quero", "confirmo", "amanha", "hoje", "ola", "oi"].includes(normalized)) {
      return null;
    }
    return trimmed.replace(/\s+/g, " ").trim();
  }

  return null;
}

function buildMissingReservationProfileReply(
  missingName: boolean,
  missingVehicle: ("modelo" | "ano" | "km")[]
): string {
  const parts: string[] = [];
  if (missingName) parts.push("*nome do cliente*");
  if (missingVehicle.includes("modelo")) parts.push("*modelo do veículo*");
  if (missingVehicle.includes("ano")) parts.push("*ano do veículo*");
  if (missingVehicle.includes("km")) parts.push("*quilometragem (km)*");

  if (parts.length === 0) {
    return "Perfeito. Pode me confirmar a reserva?";
  }
  if (parts.length === 1) {
    return `Antes de confirmar, me informe ${parts[0]}.`;
  }
  return `Antes de confirmar, me informe ${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}.`;
}

function looksLikeReservationConfirmation(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(sim|confirmo|confirmar|pode confirmar|fechar|fechado|ok|pode ser|quero)\b/.test(t) &&
    !/\b(não|nao|cancelar|desmarcar)\b/.test(t)
  );
}

function parseStartAt(dateStr: string, timeStr: string): Date {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10) - 1;
  const day = parseInt(dateStr.slice(8, 10), 10);
  const [hour, min] = timeStr.split(":").map(Number);
  return new Date(year, month, day, hour, min ?? 0, 0);
}

async function savePendingReservation(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  payload: { dateStr: string; timeStr: string; durationMinutes: number } | null
): Promise<void> {
  const nextMetadata = { ...currentMetadata };
  if (payload) {
    nextMetadata.pendingReservation = payload;
  } else {
    delete nextMetadata.pendingReservation;
  }

  await db
    .update(conversations)
    .set({
      conversationStateMetadata:
        Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

function enforceReservationReply(ctx: OrchestrationContext, aiReply: string): string {
  if (!ctx.reservationsEnabled || !looksLikeFallbackReservationReply(aiReply)) {
    return aiReply;
  }

  if (ctx.vehicleSlots && hasAllVehicleSlots(ctx.vehicleSlots)) {
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

  const [contact] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, params.contactId))
    .limit(1);

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};
  const systemPrompt = (aiAgent.systemPrompt as string) ?? "";
  const reservationsEnabled = !!(settings.reservationsEnabled as boolean);
  const usesVehicleSlots =
    /modelo|ano|quilometragem|veículo/i.test(systemPrompt) &&
    /agendamento|agendar|mecânica/i.test(systemPrompt);
  const shouldExtractVehicleSlots = usesVehicleSlots || reservationsEnabled;

  const metadata = (conv.conversationStateMetadata as Record<string, unknown>) ?? {};
  const existingSlots = metadata.vehicleSlots as VehicleSlots | undefined;
  const pendingReservation = metadata.pendingReservation as
    | { dateStr?: string; timeStr?: string; durationMinutes?: number }
    | undefined;

  let vehicleSlots = existingSlots;
  if (shouldExtractVehicleSlots) {
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
    reservationsEnabled,
    // default seguro: se não vier configurado, considera IA habilitada
    aiAgentEnabled: aiAgent.enabled !== false,
    aiAgentUseAsFallback: aiAgent.useAsFallback !== false,
    vehicleSlots: shouldExtractVehicleSlots ? vehicleSlots : undefined,
    usesVehicleSlots,
    contactName: contact?.name ?? null,
    pendingReservation:
      pendingReservation?.dateStr && pendingReservation?.timeStr
        ? {
            dateStr: pendingReservation.dateStr,
            timeStr: pendingReservation.timeStr,
            durationMinutes: pendingReservation.durationMinutes ?? 60,
          }
        : undefined,
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
    const why = [
      !ctx.aiAgentEnabled ? "enabled=false" : null,
      !ctx.aiAgentUseAsFallback ? "useAsFallback=false" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      decision: "automation_only",
      reason: `IA desativada ou não é fallback${why ? ` (${why})` : ""}`,
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
  sendMessage: (convId: string, text: string) => Promise<void>,
  options?: { traceId?: string }
): Promise<boolean> {
  const aiStartedAt = Date.now();
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
        traceId: options?.traceId,
        stage: "orchestrator.ai",
        decisionCode: "AI_RESPONSE_FILTERED",
        durationMs: Date.now() - aiStartedAt,
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
      traceId: options?.traceId,
      stage: "orchestrator.ai",
      decisionCode: "AI_RESPONSE_SENT",
      durationMs: Date.now() - aiStartedAt,
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
      traceId: options?.traceId,
      stage: "orchestrator.ai",
      decisionCode: "AI_CALL_ERROR",
      durationMs: Date.now() - aiStartedAt,
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
  const startedAt = Date.now();
  const ctx = await loadConversationContext(params);
  if (!ctx) {
    return { didReply: options.automationDidReply, decision: "silence", reason: "Contexto não encontrado", silence: true };
  }

  const [convMetaRow] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, ctx.conversationId))
    .limit(1);
  const conversationMetadata =
    (convMetaRow?.conversationStateMetadata as Record<string, unknown>) ?? {};
  let contactName = ctx.contactName ?? null;

  const inferredName = extractCustomerName(ctx.messageContent);
  if (!contactName && inferredName) {
    await db
      .update(contacts)
      .set({ name: inferredName, updatedAt: new Date() })
      .where(eq(contacts.id, ctx.contactId));
    contactName = inferredName;
  }
  const missingVehicleProfile = getMissingSlots(ctx.vehicleSlots ?? {});
  const missingNameProfile = !contactName;

  // Se alguma regra já respondeu texto na automação, evita resposta duplicada.
  if (options.automationDidReply) {
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "orchestrator_skipped",
      decision: "automation_only",
      reason: "Automação já respondeu",
      traceId: params.traceId,
      stage: "orchestrator.entry",
      decisionCode: "AUTOMATION_ALREADY_REPLIED",
      durationMs: Date.now() - startedAt,
    });
    return { didReply: true, decision: "automation_only", reason: "Automação respondeu", silence: false };
  }

  // Se já existe horário pendente de confirmação e cliente confirmou, cria a reserva.
  if (ctx.reservationsEnabled && ctx.pendingReservation) {
    const pending = ctx.pendingReservation;
    const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
    const missingName = !contactName;

    if (!looksLikeReservationConfirmation(ctx.messageContent)) {
      if (missingName || missingVehicle.length > 0) {
        await options.sendMessage(
          ctx.conversationId,
          buildMissingReservationProfileReply(missingName, missingVehicle)
        );
        await logOrchestration({
          conversationId: ctx.conversationId,
          organizationId: ctx.organizationId,
          event: "reservation_pending_collect_profile",
          decision: "tool_then_ai",
          reason: "Reserva pendente aguardando nome/dados do veículo",
          traceId: params.traceId,
          stage: "orchestrator.reservations",
          decisionCode: "RESERVATION_PENDING_COLLECT_PROFILE",
          durationMs: Date.now() - startedAt,
          metadata: {
            missingName,
            missingVehicle,
            vehicleSlots: ctx.vehicleSlots ?? null,
            pendingReservation: pending,
          },
        });
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Reserva pendente: coletando dados faltantes",
          silence: false,
        };
      }

      await options.sendMessage(
        ctx.conversationId,
        "Perfeito. Se estiver tudo certo, responda *sim* para eu confirmar a reserva."
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_pending_waiting_confirmation",
        decision: "tool_then_ai",
        reason: "Reserva pendente aguardando confirmação explícita",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_PENDING_WAIT_CONFIRMATION",
        durationMs: Date.now() - startedAt,
        metadata: {
          pendingReservation: pending,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Reserva pendente aguardando confirmação",
        silence: false,
      };
    }

    if (missingName || missingVehicle.length > 0) {
      await options.sendMessage(
        ctx.conversationId,
        buildMissingReservationProfileReply(missingName, missingVehicle)
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_confirm_blocked_missing_profile",
        decision: "tool_then_ai",
        reason: "Confirmação recebida sem nome/dados do veículo completos",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_CONFIRM_BLOCKED_MISSING_PROFILE",
        durationMs: Date.now() - startedAt,
        metadata: {
          missingName,
          missingVehicle,
          vehicleSlots: ctx.vehicleSlots ?? null,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitando nome e/ou dados do veículo antes da confirmação",
        silence: false,
      };
    }

    const recheck = await checkAvailabilityForOrg(
      ctx.organizationId,
      pending.dateStr,
      pending.timeStr,
      pending.durationMinutes
    );

    if (!recheck.available) {
      await savePendingReservation(ctx.conversationId, conversationMetadata, null);
      await options.sendMessage(
        ctx.conversationId,
        "Esse horário acabou de ficar indisponível. Me diga outro dia e horário que eu consulto agora."
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_confirm_failed_unavailable",
        decision: "tool_then_ai",
        reason: "Confirmação recebida, mas horário ficou indisponível",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_CONFIRM_UNAVAILABLE",
        durationMs: Date.now() - startedAt,
        metadata: {
          pendingReservation: pending,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Confirmação recebida com horário indisponível",
        silence: false,
      };
    }

    const startAt = parseStartAt(pending.dateStr, pending.timeStr);
    const reservationNotes = JSON.stringify({
      customerName: contactName,
      vehicle: {
        modelo: ctx.vehicleSlots?.modelo ?? null,
        ano: ctx.vehicleSlots?.ano ?? null,
        km: ctx.vehicleSlots?.km ?? null,
      },
    });
    const created = await createReservationForOrg(ctx.organizationId, {
      startAt,
      durationMinutes: pending.durationMinutes,
      contactId: ctx.contactId,
      notes: reservationNotes,
      source: "ai",
    });
    await savePendingReservation(ctx.conversationId, conversationMetadata, null);

    if (created?.success) {
      const friendlyDate = formatDateForPtBr(pending.dateStr);
      await options.sendMessage(
        ctx.conversationId,
        `Perfeito. Reserva confirmada para ${friendlyDate} às ${pending.timeStr}.`
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_confirmed",
        decision: "tool_then_ai",
        reason: "Reserva criada após confirmação do cliente",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_CONFIRMED",
        durationMs: Date.now() - startedAt,
        metadata: {
          reservationId: created.reservation?.id ?? null,
          pendingReservation: pending,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Reserva confirmada com sucesso",
        silence: false,
      };
    }
  }

  // Fluxo determinístico de reservas: não depende do fallback da IA.
  // Se já temos dados do veículo, guiamos o próximo passo mesmo com useAsFallback=false.
  if (ctx.reservationsEnabled && ctx.vehicleSlots && hasAllVehicleSlots(ctx.vehicleSlots)) {
    const parsedCurrentMessage = extractReservationDateTime(ctx.messageContent);
    const parsedFromHistory =
      !parsedCurrentMessage && looksLikeVehicleInfoMessage(ctx.messageContent)
        ? await findLatestInboundReservationDateTime(ctx.conversationId)
        : null;
    const parsed = parsedCurrentMessage ?? parsedFromHistory;

    if (parsed) {
      if (missingNameProfile) {
        await savePendingReservation(ctx.conversationId, conversationMetadata, {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          durationMinutes: 60,
        });
        await options.sendMessage(
          ctx.conversationId,
          buildMissingReservationProfileReply(true, [])
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Solicitando nome antes de confirmar reserva",
          silence: false,
        };
      }
      const availability = await checkAvailabilityForOrg(
        ctx.organizationId,
        parsed.dateStr,
        parsed.timeStr,
        60
      );
      const reply = buildAvailabilityReply(parsed, availability.available);

      await options.sendMessage(ctx.conversationId, reply);
      await savePendingReservation(
        ctx.conversationId,
        conversationMetadata,
        availability.available
          ? {
              dateStr: parsed.dateStr,
              timeStr: parsed.timeStr,
              durationMinutes: 60,
            }
          : null
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_auto_check",
        decision: "tool_then_ai",
        reason: "Disponibilidade consultada automaticamente pelo orquestrador",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_AUTO_CHECK",
        durationMs: Date.now() - startedAt,
        metadata: {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          available: availability.available,
          source: parsedCurrentMessage ? "current_message" : "history_message",
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Disponibilidade consultada automaticamente",
        silence: false,
      };
    }

    if (!containsDateOrTimeHint(ctx.messageContent)) {
      const reply =
        "Posso consultar a disponibilidade e já reservar um horário para você. Qual data e horário prefere?";
      await options.sendMessage(ctx.conversationId, reply);
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_next_step",
        decision: "tool_then_ai",
        reason: "Solicitando data/horário após dados completos do veículo",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_ASK_DATE_TIME",
        durationMs: Date.now() - startedAt,
        metadata: {
          vehicleSlots: ctx.vehicleSlots,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitou data/horário para continuar reserva",
        silence: false,
      };
    }
  }

  // Fluxo determinístico para reservas gerais (sem exigir slots de veículo):
  // se cliente informar data/hora e reservas estiverem ativas, consulta disponibilidade.
  if (ctx.reservationsEnabled && !ctx.usesVehicleSlots) {
    const parsed = extractReservationDateTime(ctx.messageContent);
    if (parsed) {
      if (missingNameProfile || missingVehicleProfile.length > 0) {
        await savePendingReservation(ctx.conversationId, conversationMetadata, {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          durationMinutes: 60,
        });
        await options.sendMessage(
          ctx.conversationId,
          buildMissingReservationProfileReply(missingNameProfile, missingVehicleProfile)
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Solicitando nome/dados do veículo antes de confirmar reserva",
          silence: false,
        };
      }
      const availability = await checkAvailabilityForOrg(
        ctx.organizationId,
        parsed.dateStr,
        parsed.timeStr,
        60
      );
      const reply = buildAvailabilityReply(parsed, availability.available);

      await options.sendMessage(ctx.conversationId, reply);
      await savePendingReservation(
        ctx.conversationId,
        conversationMetadata,
        availability.available
          ? {
              dateStr: parsed.dateStr,
              timeStr: parsed.timeStr,
              durationMinutes: 60,
            }
          : null
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_auto_check_general",
        decision: "tool_then_ai",
        reason: "Disponibilidade consultada automaticamente em fluxo geral",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_AUTO_CHECK_GENERAL",
        durationMs: Date.now() - startedAt,
        metadata: {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          available: availability.available,
          usesVehicleSlots: ctx.usesVehicleSlots ?? false,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Disponibilidade consultada automaticamente (fluxo geral)",
        silence: false,
      };
    }
  }

  // Fluxo determinístico para oficinas: mesmo sem fallback da IA, o sistema continua
  // guiando o cliente no agendamento (evita "silêncio" com useAsFallback=false).
  if (ctx.reservationsEnabled && ctx.usesVehicleSlots) {
    const hasDateOrTime = containsDateOrTimeHint(ctx.messageContent);
    const slots = ctx.vehicleSlots ?? {};
    const missing = getMissingSlots(slots);

    if (hasDateOrTime && missing.length > 0) {
      const reply = buildMissingVehicleInfoReply(missing);
      await options.sendMessage(ctx.conversationId, reply);
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_collect_missing_vehicle_info",
        decision: "tool_then_ai",
        reason: "Cliente informou data/horário, mas faltam dados do veículo",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_COLLECT_MISSING_VEHICLE_INFO",
        durationMs: Date.now() - startedAt,
        metadata: {
          missingSlots: missing,
          vehicleSlots: slots,
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitando dados faltantes do veículo para reservar",
        silence: false,
      };
    }
  }

  // Fail-safe de reservas:
  // se houver intenção clara de agendamento (data/hora), nunca deixa cair em silêncio
  // por causa de fallback desativado.
  if (ctx.reservationsEnabled && containsDateOrTimeHint(ctx.messageContent)) {
    const slots = ctx.vehicleSlots ?? {};
    const missing = getMissingSlots(slots);

    if (ctx.usesVehicleSlots && missing.length > 0) {
      const reply = buildMissingVehicleInfoReply(missing);
      await options.sendMessage(ctx.conversationId, reply);
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_fail_safe_missing_vehicle_info",
        decision: "tool_then_ai",
        reason: "Fail-safe: intenção de reserva com dados de veículo incompletos",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_FAIL_SAFE_MISSING_VEHICLE_INFO",
        durationMs: Date.now() - startedAt,
        metadata: {
          missingSlots: missing,
          vehicleSlots: slots,
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Fail-safe de reservas: solicitando dados faltantes do veículo",
        silence: false,
      };
    }

    const parsed =
      extractReservationDateTime(ctx.messageContent) ??
      (await findLatestInboundReservationDateTime(ctx.conversationId));

    if (parsed) {
      if (missingNameProfile || missing.length > 0) {
        await savePendingReservation(ctx.conversationId, conversationMetadata, {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          durationMinutes: 60,
        });
        await options.sendMessage(
          ctx.conversationId,
          buildMissingReservationProfileReply(missingNameProfile, missing)
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Fail-safe: solicitando perfil antes de confirmar reserva",
          silence: false,
        };
      }
      const availability = await checkAvailabilityForOrg(
        ctx.organizationId,
        parsed.dateStr,
        parsed.timeStr,
        60
      );
      const reply = buildAvailabilityReply(parsed, availability.available);
      await options.sendMessage(ctx.conversationId, reply);
      await savePendingReservation(
        ctx.conversationId,
        conversationMetadata,
        availability.available
          ? {
              dateStr: parsed.dateStr,
              timeStr: parsed.timeStr,
              durationMinutes: 60,
            }
          : null
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_fail_safe_auto_check",
        decision: "tool_then_ai",
        reason: "Fail-safe: disponibilidade consultada automaticamente",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_FAIL_SAFE_AUTO_CHECK",
        durationMs: Date.now() - startedAt,
        metadata: {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          available: availability.available,
          usesVehicleSlots: ctx.usesVehicleSlots ?? false,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Fail-safe de reservas: disponibilidade consultada",
        silence: false,
      };
    }

    await options.sendMessage(
      ctx.conversationId,
      "Entendi que você quer agendar. Pode me confirmar o *dia* e *horário* no formato, por exemplo: *28/02 às 14:00*?"
    );
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "reservation_fail_safe_request_normalized_datetime",
      decision: "tool_then_ai",
      reason: "Fail-safe: não foi possível normalizar data/hora",
      traceId: params.traceId,
      stage: "orchestrator.reservations",
      decisionCode: "RESERVATION_FAIL_SAFE_REQUEST_NORMALIZED_DATETIME",
      durationMs: Date.now() - startedAt,
      metadata: {
        messageContent: ctx.messageContent,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Fail-safe de reservas: solicitando data/hora em formato claro",
      silence: false,
    };
  }

  const result = decideNextAction(ctx);

  await logOrchestration({
    conversationId: params.conversationId,
    organizationId: params.organizationId,
    event: "decision",
    stateBefore: ctx.conversationState,
    decision: result.decision,
    reason: result.reason,
    traceId: params.traceId,
    stage: "orchestrator.decision",
    decisionCode:
      result.decision === "automation_only"
        ? "AUTOMATION_ONLY"
        : result.decision === "human_only"
          ? "HUMAN_ONLY"
          : result.decision === "silence"
            ? "SILENCE"
            : result.decision === "tool_then_ai"
              ? "TOOL_THEN_AI"
              : "AI_RESPOND",
    durationMs: Date.now() - startedAt,
    metadata: {
      reservationsEnabled: ctx.reservationsEnabled,
      usesVehicleSlots: ctx.usesVehicleSlots ?? false,
      vehicleSlots: ctx.vehicleSlots ?? null,
      messageContent: ctx.messageContent,
    },
  });

  if (!result.shouldCallAI) {
    return {
      didReply: false,
      decision: result.decision,
      reason: result.reason,
      silence: !result.shouldRespond,
    };
  }

  const aiReplied = await callAIWithContext(ctx, options.sendMessage, {
    traceId: params.traceId,
  });
  return {
    didReply: aiReplied,
    decision: result.decision,
    reason: result.reason,
    silence: false,
  };
}
