/**
 * Orquestrador de conversa - camada central que controla o fluxo.
 * A IA nunca responde diretamente ao webhook sem passar por aqui.
 */

import { db } from "@/lib/db";
import { conversations, organizations, messages, contacts, products, services } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { logOrchestration } from "./logger";
import { filterResponse } from "./response-filter";
import { handoffToHuman } from "./handoff";
import { generateAIReply } from "@/lib/ai-agent";
import { checkAvailabilityForOrg, createReservationForOrg } from "@/lib/reservations";
import { getContactMemories, saveContactMemory } from "@/lib/contact-memories";
import {
  extractSlotsFromMessages,
  extractVehicleSlotsFromText,
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

function looksLikeGreeting(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    t === "oi" ||
    t === "ola" ||
    t.startsWith("oi ") ||
    t.startsWith("ola ") ||
    t.startsWith("bom dia") ||
    t.startsWith("boa tarde") ||
    t.startsWith("boa noite") ||
    t.startsWith("e ai") ||
    t.startsWith("opa") ||
    t.startsWith("hey")
  );
}

function looksLikeAskKnownName(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\b(sabe|lembra|tem)\b.*\b(meu nome|nome)\b/.test(t);
}

function looksLikeAskKnownVehicle(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\b(sabe|lembra|entendeu|tem)\b.*\b(carro|veiculo|modelo)\b/.test(t);
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

function looksLikeReservationIntent(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    /\b(agendar|agendamento|reservar|reserva|horario|horarios|disponibilidade|vaga|vagas)\b/.test(
      t
    ) ||
    containsDateOrTimeHint(t)
  );
}

function looksLikeCatalogIntent(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\b(valor|preco|orcamento|quanto|produto|peca|oleo|filtro|servico|troca|revisao)\b/.test(
    t
  );
}

function formatCurrencyFromCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchTokens(text: string): string[] {
  const stop = new Set([
    "qual",
    "quais",
    "valor",
    "preco",
    "orcamento",
    "quanto",
    "tem",
    "de",
    "da",
    "do",
    "um",
    "uma",
    "pra",
    "para",
    "troca",
    "servico",
    "produto",
  ]);
  return normalizeForSearch(text)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

function getCatalogPromptRepeatState(
  metadata: Record<string, unknown>,
  promptKey: string
): { repeatCount: number; nextCount: number } {
  const flow = (metadata.catalogFlow as Record<string, unknown> | undefined) ?? {};
  const lastPromptKey = typeof flow.lastPromptKey === "string" ? flow.lastPromptKey : "";
  const lastPromptRepeatCount =
    typeof flow.lastPromptRepeatCount === "number" ? flow.lastPromptRepeatCount : 0;
  const repeatCount = lastPromptKey === promptKey ? lastPromptRepeatCount : 0;
  return { repeatCount, nextCount: repeatCount + 1 };
}

async function persistCatalogPromptState(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  promptKey: string,
  nextCount: number
): Promise<void> {
  const flow = (currentMetadata.catalogFlow as Record<string, unknown> | undefined) ?? {};
  const nextMetadata = {
    ...currentMetadata,
    catalogFlow: {
      ...flow,
      lastPromptKey: promptKey,
      lastPromptRepeatCount: nextCount,
      updatedAt: new Date().toISOString(),
    },
  };

  await db
    .update(conversations)
    .set({
      conversationStateMetadata: nextMetadata,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

function buildCatalogClarificationReply(repeatCount: number): string {
  if (repeatCount <= 0) {
    return "Quero te passar o valor certo. É *troca de óleo*, *revisão* ou outro serviço?";
  }
  if (repeatCount === 1) {
    return "Me descreve rapidinho o que você quer cotar e, se tiver, o item (ex.: troca de óleo 5W30).";
  }
  return "Pra eu te atender sem erro, manda em uma frase: *serviço + produto/veículo*. Ex.: *valor da troca de óleo 5W30 do Onix 2022*.";
}

function buildCatalogQueryWithContext(
  messageContent: string,
  context: { serviceName: string | null; productName: string | null }
): string {
  const normalized = normalizeForSearch(messageContent);
  const hasSpecificNeed =
    /\b(oleo|filtro|revisao|freio|alinhamento|balanceamento|suspensao|embreagem|bateria|pneu|motor)\b/.test(
      normalized
    );
  if (!looksLikeCatalogIntent(messageContent) || hasSpecificNeed) {
    return messageContent;
  }
  const ctxTerms = [context.serviceName, context.productName].filter(
    (v): v is string => !!v?.trim()
  );
  if (ctxTerms.length === 0) return messageContent;
  return `${messageContent} ${ctxTerms.join(" ")}`;
}

function scoreMatch(haystack: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const normalized = normalizeForSearch(haystack);
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) score += 1;
  }
  return score;
}

function extractOilSpec(text: string): string | null {
  const normalized = normalizeForSearch(text);
  const match = normalized.match(/\b(\d{1,2}\s*w\s*\d{2})\b/i);
  if (!match) return null;
  return match[1].replace(/\s+/g, "").toUpperCase();
}

function isOilExchangeIntent(text: string): boolean {
  const t = normalizeForSearch(text);
  return /\b(oleo|troca de oleo|troca oleo|lubrificacao)\b/.test(t);
}

function shouldAskOilQualification(text: string): boolean {
  return isOilExchangeIntent(text) && !extractOilSpec(text);
}

function isGenericBudgetRequest(text: string): boolean {
  const t = normalizeForSearch(text);
  const asksBudget = /\b(orcamento|preco|valor|quanto)\b/.test(t);
  const hasSpecificNeed =
    /\b(oleo|filtro|troca|revisao|freio|alinhamento|balanceamento|suspensao|embreagem|bateria|pneu|motor)\b/.test(
      t
    );
  return asksBudget && !hasSpecificNeed;
}

async function buildCatalogReply(
  organizationId: string,
  messageContent: string,
  options?: { skipIntentCheck?: boolean }
): Promise<{
  reply: string;
  productMatches: number;
  serviceMatches: number;
  selectedProductName: string | null;
  selectedServiceName: string | null;
} | null> {
  if (!options?.skipIntentCheck && !looksLikeCatalogIntent(messageContent)) return null;

  const tokens = extractSearchTokens(messageContent);
  const [allProducts, allServices] = await Promise.all([
    db
      .select()
      .from(products)
      .where(eq(products.organizationId, organizationId)),
    db
      .select()
      .from(services)
      .where(eq(services.organizationId, organizationId)),
  ]);

  const oilSpec = extractOilSpec(messageContent);

  const productMatches = allProducts
    .filter((p) => p.isActive)
    .map((p) => ({
      item: p,
      score: scoreMatch(`${p.name} ${p.model ?? ""} ${p.description ?? ""}`, tokens),
    }))
    .filter((x) => x.score > 0)
    .filter((x) => {
      if (!oilSpec) return true;
      const haystack = normalizeForSearch(`${x.item.name} ${x.item.model ?? ""} ${x.item.description ?? ""}`);
      const normalizedOilSpec = normalizeForSearch(oilSpec);
      return haystack.includes(normalizedOilSpec);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.item);

  const serviceMatches = allServices
    .filter((s) => s.isActive)
    .map((s) => ({
      item: s,
      score: scoreMatch(`${s.name} ${s.description ?? ""}`, tokens),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.item);

  if (productMatches.length === 0 && serviceMatches.length === 0) {
    return null;
  }

  const lines: string[] = [];
  if (productMatches.length > 0) {
    lines.push("*Produtos encontrados:*");
    for (const p of productMatches) {
      const stockText =
        p.stockQuantity > 0 ? `em estoque (${p.stockQuantity})` : "sem estoque no momento";
      const modelText = p.model ? ` - ${p.model}` : "";
      lines.push(`- ${p.name}${modelText}: ${formatCurrencyFromCents(p.priceCents)} (${stockText})`);
    }
  }
  if (serviceMatches.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("*Serviços encontrados:*");
    for (const s of serviceMatches) {
      lines.push(`- ${s.name}: ${formatCurrencyFromCents(s.priceCents)} (${s.durationMinutes} min)`);
    }
  }
  lines.push("");
  lines.push("Se você quiser, já deixo um horário reservado pra resolver isso. Qual dia e horário prefere?");

  return {
    reply: lines.join("\n"),
    productMatches: productMatches.length,
    serviceMatches: serviceMatches.length,
    selectedProductName: productMatches[0]?.name ?? null,
    selectedServiceName: serviceMatches[0]?.name ?? null,
  };
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

function normalizePlainText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelySingleWordHumanName(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (containsDateOrTimeHint(trimmed) || looksLikeReservationIntent(trimmed)) return false;
  if (!/^[a-zà-ú' ]{2,40}$/i.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length !== 1) return false;
  const normalized = normalizePlainText(trimmed);
  if (
    [
      "oi",
      "ola",
      "ok",
      "sim",
      "quero",
      "confirmo",
      "onix",
      "gol",
      "hb20",
      "civic",
      "corolla",
      "palio",
      "uno",
      "ka",
      "fox",
      "sandero",
      "prisma",
      "tracker",
      "compass",
      "renegade",
    ].includes(normalized)
  ) {
    return false;
  }
  if (/\b\d{1,2}\s*w\s*\d{2}\b/i.test(normalized)) return false;
  return true;
}

function hasExplicitNameIntro(text: string): boolean {
  return /\b(meu nome e|meu nome é|me chamo|sou o|sou a)\b/i.test(text.trim());
}

function extractCustomerName(
  text: string,
  options?: {
    allowSingleWord?: boolean;
    blockedValues?: string[];
  }
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (containsDateOrTimeHint(lower) || looksLikeReservationConfirmation(lower)) return null;

  const explicit = trimmed.match(/\b(?:meu nome é|me chamo|sou o|sou a)\s+([a-zà-ú' ]{2,40})$/i);
  if (explicit?.[1]) {
    const name = explicit[1].replace(/\s+/g, " ").trim();
    return name.length >= 2 ? name : null;
  }

  // Ex.: "Mateus, onix 2019 com 80milkm" -> captura "Mateus"
  const leadingSegment = trimmed.split(",")[0]?.trim();
  if (
    leadingSegment &&
    leadingSegment !== trimmed &&
    /^[a-zà-ú' ]{2,40}$/i.test(leadingSegment)
  ) {
    const normalizedLeading = normalizePlainText(leadingSegment);
    if (
      !["sim", "ok", "quero", "confirmo", "amanha", "hoje", "ola", "oi"].includes(
        normalizedLeading
      ) &&
      !((options?.blockedValues ?? []).map(normalizePlainText).includes(normalizedLeading))
    ) {
      return leadingSegment.replace(/\s+/g, " ").trim();
    }
  }

  if (/^[a-zà-ú' ]{2,40}$/i.test(trimmed) && trimmed.split(/\s+/).length <= 3) {
    const normalized = normalizePlainText(trimmed);
    const wordsCount = normalized.split(" ").filter(Boolean).length;
    if (wordsCount === 1 && !options?.allowSingleWord) return null;
    if (
      [
        "sim",
        "ok",
        "quero",
        "confirmo",
        "amanha",
        "hoje",
        "ola",
        "oi",
        "onix",
        "gol",
        "hb20",
        "civic",
        "corolla",
      ].includes(normalized)
    ) {
      return null;
    }
    if ((options?.blockedValues ?? []).map(normalizePlainText).includes(normalized)) {
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

type SlotConfidence = "none" | "low" | "medium" | "high";
type ReservationCollectionStage =
  | "collect_profile"
  | "collect_datetime"
  | "confirm_reservation"
  | "completed";
type IntakeStage = "awaiting_need" | "awaiting_issue" | "awaiting_reservation_profile";

function inferCollectionStage(
  missingName: boolean,
  missingVehicle: ("modelo" | "ano" | "km")[],
  pendingReservation: OrchestrationContext["pendingReservation"]
): ReservationCollectionStage {
  if (missingName || missingVehicle.length > 0) return "collect_profile";
  if (pendingReservation) return "confirm_reservation";
  return "collect_datetime";
}

function buildSlotConfidenceMap(
  contactName: string | null,
  slots: VehicleSlots
): Record<"nome" | "modelo" | "ano" | "km", SlotConfidence> {
  const nome: SlotConfidence = contactName ? (contactName.trim().length >= 3 ? "high" : "medium") : "none";
  const modelo: SlotConfidence = slots.modelo
    ? slots.modelo.trim().split(/\s+/).length >= 2
      ? "high"
      : "medium"
    : "none";
  const ano: SlotConfidence = slots.ano ? "high" : "none";
  const km: SlotConfidence = slots.km ? "high" : "none";
  return { nome, modelo, ano, km };
}

function buildProfilePromptKey(
  missingName: boolean,
  missingVehicle: ("modelo" | "ano" | "km")[]
): string {
  const ordered = [...missingVehicle].sort().join(",");
  return `profile:name=${missingName ? "1" : "0"}:vehicle=${ordered || "-"}`;
}

function getPromptRepeatState(
  metadata: Record<string, unknown>,
  promptKey: string
): { repeatCount: number; nextCount: number } {
  const flow = (metadata.reservationFlow as Record<string, unknown> | undefined) ?? {};
  const lastPromptKey = typeof flow.lastPromptKey === "string" ? flow.lastPromptKey : "";
  const lastPromptRepeatCount =
    typeof flow.lastPromptRepeatCount === "number" ? flow.lastPromptRepeatCount : 0;
  const repeatCount = lastPromptKey === promptKey ? lastPromptRepeatCount : 0;
  return { repeatCount, nextCount: repeatCount + 1 };
}

function buildSmartMissingReservationProfileReply(
  missingName: boolean,
  missingVehicle: ("modelo" | "ano" | "km")[],
  repeatCount: number
): string {
  const base = buildMissingReservationProfileReply(missingName, missingVehicle);
  if (repeatCount <= 0) return base;
  if (repeatCount === 1) {
    return `${base}\n\nExemplo: *Mateus, Onix 2019, 80 mil km*.`;
  }
  return `${base}\n\nPara evitar erro, envie em uma única mensagem: *Nome, Modelo, Ano e KM*.\nExemplo: *Mateus, Onix 2019, 80 mil km*.`;
}

async function persistReservationFlowMetadata(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  patch: Record<string, unknown>
): Promise<void> {
  const currentFlow = (currentMetadata.reservationFlow as Record<string, unknown> | undefined) ?? {};
  const nextFlow = { ...currentFlow, ...patch };
  const nextMetadata = { ...currentMetadata, reservationFlow: nextFlow };
  await db
    .update(conversations)
    .set({
      conversationStateMetadata: nextMetadata,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

function getIntakeStage(metadata: Record<string, unknown>): IntakeStage | null {
  const intakeFlow = (metadata.intakeFlow as Record<string, unknown> | undefined) ?? {};
  const stage = intakeFlow.stage;
  if (
    stage === "awaiting_need" ||
    stage === "awaiting_issue" ||
    stage === "awaiting_reservation_profile"
  ) {
    return stage;
  }
  return null;
}

async function persistIntakeStage(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  stage: IntakeStage | null
): Promise<void> {
  const nextMetadata = { ...currentMetadata };
  if (stage) {
    nextMetadata.intakeFlow = { stage, updatedAt: new Date().toISOString() };
  } else {
    delete nextMetadata.intakeFlow;
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

function getReservationContext(metadata: Record<string, unknown>): {
  serviceName: string | null;
  productName: string | null;
} {
  const ctx = (metadata.reservationContext as Record<string, unknown> | undefined) ?? {};
  const serviceName = typeof ctx.serviceName === "string" ? ctx.serviceName : null;
  const productName = typeof ctx.productName === "string" ? ctx.productName : null;
  return { serviceName, productName };
}

async function persistReservationContext(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  context: { serviceName?: string | null; productName?: string | null } | null
): Promise<void> {
  const nextMetadata = { ...currentMetadata };
  if (context && (context.serviceName || context.productName)) {
    nextMetadata.reservationContext = {
      serviceName: context.serviceName ?? null,
      productName: context.productName ?? null,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMetadata.reservationContext;
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

  const [contactRows, memories] = await Promise.all([
    db
      .select({ name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, params.contactId))
      .limit(1),
    getContactMemories(params.contactId),
  ]);
  const [contact] = contactRows;

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};
  const systemPrompt = (aiAgent.systemPrompt as string) ?? "";
  const reservationsEnabled = !!(settings.reservationsEnabled as boolean);
  const usesVehicleSlots =
    /modelo|ano|quilometragem|veículo/i.test(systemPrompt) &&
    /agendamento|agendar|mecânica/i.test(systemPrompt);
  const shouldExtractVehicleSlots = usesVehicleSlots || reservationsEnabled;

  const metadata = (conv.conversationStateMetadata as Record<string, unknown>) ?? {};
  const rememberedYear = memories.vehicle_year ? Number(memories.vehicle_year) : undefined;
  const rememberedKm = memories.vehicle_km ? Number(memories.vehicle_km) : undefined;
  const memoryVehicleSlots: Partial<VehicleSlots> = {
    modelo: memories.vehicle_model || undefined,
    ano: rememberedYear && Number.isFinite(rememberedYear) ? rememberedYear : undefined,
    km: rememberedKm && Number.isFinite(rememberedKm) ? rememberedKm : undefined,
  };
  const metadataSlots = metadata.vehicleSlots as VehicleSlots | undefined;
  const existingSlots = mergeVehicleSlots(memoryVehicleSlots, metadataSlots ?? {});
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

    if (JSON.stringify(vehicleSlots) !== JSON.stringify(existingSlots)) {
      await db
        .update(conversations)
        .set({
          conversationStateMetadata: { ...metadata, vehicleSlots },
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, params.conversationId));
    }

    if (vehicleSlots?.modelo) {
      await saveContactMemory(params.contactId, "vehicle_model", vehicleSlots.modelo);
    }
    if (vehicleSlots?.ano) {
      await saveContactMemory(params.contactId, "vehicle_year", String(vehicleSlots.ano));
    }
    if (vehicleSlots?.km) {
      await saveContactMemory(params.contactId, "vehicle_km", String(vehicleSlots.km));
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
  const intakeStage = getIntakeStage(conversationMetadata);
  const reservationContext = getReservationContext(conversationMetadata);
  const reservationFlow = (conversationMetadata.reservationFlow as Record<string, unknown> | undefined) ?? {};
  const isCollectProfileStage = reservationFlow.collectionStage === "collect_profile";
  let contactName = ctx.contactName ?? null;
  const isReservationProfileCollection =
    ctx.reservationsEnabled && ctx.usesVehicleSlots && !contactName;
  const isPendingWithoutName = !!ctx.pendingReservation && !contactName;
  const allowSingleWordName = isPendingWithoutName || isReservationProfileCollection;
  const explicitNameIntro = hasExplicitNameIntro(ctx.messageContent);
  const wantsNameUpdate = !!contactName && explicitNameIntro;
  const canCaptureNameNow =
    (!contactName && (explicitNameIntro || isCollectProfileStage)) || wantsNameUpdate;
  let inferredName: string | null = null;
  if (canCaptureNameNow) {
    inferredName = extractCustomerName(ctx.messageContent, {
      allowSingleWord: allowSingleWordName,
      blockedValues: [ctx.vehicleSlots?.modelo ?? ""],
    });
  }
  // Fallback: se houver conflito com modelo extraído, tenta novamente sem bloqueio.
  // Isso evita loop em casos como "Mateus" ser confundido com modelo.
  if (!inferredName && !contactName && canCaptureNameNow) {
    inferredName = extractCustomerName(ctx.messageContent, {
      allowSingleWord: allowSingleWordName,
    });
  }
  const justCapturedName = !contactName && !!inferredName;
  if (!contactName && inferredName) {
    await db
      .update(contacts)
      .set({ name: inferredName, updatedAt: new Date() })
      .where(eq(contacts.id, ctx.contactId));
    contactName = inferredName;
  } else if (contactName && inferredName && explicitNameIntro) {
    const normalize = (v: string) =>
      v
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (normalize(inferredName) !== normalize(contactName)) {
      await db
        .update(contacts)
        .set({ name: inferredName, updatedAt: new Date() })
        .where(eq(contacts.id, ctx.contactId));
      contactName = inferredName;
    }
  }
  const missingVehicleProfile = getMissingSlots(ctx.vehicleSlots ?? {});
  const missingNameProfile = !contactName;
  const likelySingleWordName = isLikelySingleWordHumanName(ctx.messageContent);

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

  if (
    ctx.reservationsEnabled &&
    ctx.usesVehicleSlots &&
    (ctx.pendingReservation || intakeStage === "awaiting_reservation_profile") &&
    (missingNameProfile || missingVehicleProfile.length > 0) &&
    likelySingleWordName &&
    isCollectProfileStage
  ) {
    const promptKey = buildProfilePromptKey(missingNameProfile, missingVehicleProfile);
    const promptState = getPromptRepeatState(conversationMetadata, promptKey);
    const candidateName = ctx.messageContent.trim().replace(/\s+/g, " ");
    const baseMissingReply = buildSmartMissingReservationProfileReply(
      missingNameProfile,
      missingVehicleProfile,
      promptState.repeatCount
    );
    const clarificationPrefix = missingNameProfile
      ? `Só para confirmar: *${candidateName}* é seu nome?\n`
      : contactName
        ? `Perfeito, *${contactName}*. `
        : "";
    await options.sendMessage(
      ctx.conversationId,
      `${clarificationPrefix}${baseMissingReply}`.trim()
    );
    await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
      collectionStage: "collect_profile",
      lastPromptKey: promptKey,
      lastPromptRepeatCount: promptState.nextCount,
      slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
    });
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "reservation_profile_single_name_clarification",
      decision: "tool_then_ai",
      reason: "Mensagem curta tratada como possível nome; solicitando perfil restante",
      traceId: params.traceId,
      stage: "orchestrator.reservations",
      decisionCode: "RESERVATION_PROFILE_SINGLE_NAME_CLARIFY",
      durationMs: Date.now() - startedAt,
      metadata: {
        messageContent: ctx.messageContent,
        candidateName,
        missingName: missingNameProfile,
        missingVehicle: missingVehicleProfile,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Confirmação de nome e coleta de dados faltantes",
      silence: false,
    };
  }

  // Respeita pausa manual da IA/handoff humano antes de qualquer fluxo determinístico.
  // Sem isso, o orquestrador poderia responder mesmo com IA desativada no contato.
  const isHumanOnlyState =
    ctx.conversationState === CONVERSATION_STATES.WAITING_HUMAN ||
    ctx.conversationState === CONVERSATION_STATES.HUMAN_ACTIVE;
  const isAiPaused = !!(ctx.aiDisabledUntil && ctx.aiDisabledUntil > new Date());
  if (isHumanOnlyState || isAiPaused) {
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "decision",
      stateBefore: ctx.conversationState,
      decision: "human_only",
      reason: isAiPaused ? "IA pausada manualmente" : "Conversa aguardando humano",
      traceId: params.traceId,
      stage: "orchestrator.decision",
      decisionCode: "HUMAN_ONLY",
      durationMs: Date.now() - startedAt,
      metadata: {
        reservationsEnabled: ctx.reservationsEnabled,
        usesVehicleSlots: ctx.usesVehicleSlots ?? false,
        vehicleSlots: ctx.vehicleSlots ?? null,
        messageContent: ctx.messageContent,
      },
    });
    return {
      didReply: false,
      decision: "human_only",
      reason: isAiPaused ? "IA pausada manualmente" : "Conversa aguardando humano",
      silence: true,
    };
  }

  if (looksLikeAskKnownName(ctx.messageContent) || looksLikeAskKnownVehicle(ctx.messageContent)) {
    const knownName = contactName?.trim() || null;
    const knownVehicle = ctx.vehicleSlots ?? {};
    const hasKnownVehicle = !!(knownVehicle.modelo || knownVehicle.ano || knownVehicle.km);
    const vehicleLabel = [
      knownVehicle.modelo ? knownVehicle.modelo : null,
      knownVehicle.ano ? String(knownVehicle.ano) : null,
      knownVehicle.km ? `${knownVehicle.km} km` : null,
    ]
      .filter(Boolean)
      .join(" - ");

    let reply = "Ainda não tenho tudo salvo aqui.";
    if (knownName && hasKnownVehicle) {
      reply = `Tenho sim: nome *${knownName}* e veículo *${vehicleLabel}*. Continua com esses dados?`;
    } else if (knownName) {
      reply = `Tenho seu nome salvo como *${knownName}*. Pode me confirmar modelo, ano e km do veículo para eu atualizar?`;
    } else if (hasKnownVehicle) {
      reply = `Tenho seu veículo salvo como *${vehicleLabel}*. Pode me confirmar se continua com ele? Se quiser, já me passe seu nome também.`;
    } else {
      reply = "Ainda não tenho seu nome e veículo salvos. Me passe, por favor: *nome, modelo, ano e km*.";
    }

    await options.sendMessage(ctx.conversationId, reply);
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "known_profile_reply",
      decision: "tool_then_ai",
      reason: "Cliente perguntou dados já salvos (nome/veículo)",
      traceId: params.traceId,
      stage: "orchestrator.profile",
      decisionCode: "KNOWN_PROFILE_REPLY",
      durationMs: Date.now() - startedAt,
      metadata: {
        hasKnownName: !!knownName,
        hasKnownVehicle,
        knownVehicle,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Retorno de dados salvos para cliente",
      silence: false,
    };
  }

  // Abordagem inicial neutra: entende a dúvida antes de mencionar opções.
  if (
    ctx.reservationsEnabled &&
    ctx.usesVehicleSlots &&
    looksLikeGreeting(ctx.messageContent) &&
    !ctx.pendingReservation &&
    !looksLikeReservationIntent(ctx.messageContent)
  ) {
    const triageReply = "Olá, tudo bem? Qual sua dúvida?";
    await options.sendMessage(ctx.conversationId, triageReply);
    await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_need");
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "intake_greeting",
      decision: "tool_then_ai",
      reason: "Saudação recebida; iniciando descoberta da necessidade",
      traceId: params.traceId,
      stage: "orchestrator.reservations",
      decisionCode: "INTAKE_GREETING",
      durationMs: Date.now() - startedAt,
      metadata: {
        messageContent: ctx.messageContent,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Pergunta inicial enviada",
      silence: false,
    };
  }

  if (intakeStage === "awaiting_need" && !looksLikeReservationIntent(ctx.messageContent)) {
    if (shouldAskOilQualification(ctx.messageContent)) {
      const oilQualificationReply =
        "Perfeito! Pra eu te passar certinho, qual óleo seu carro usa (ex.: 5W30, 10W40) e qual é o veículo/ano?";
      await options.sendMessage(ctx.conversationId, oilQualificationReply);
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "intake_ask_oil_spec",
        decision: "tool_then_ai",
        reason: "Cliente pediu troca de óleo sem especificação do tipo",
        traceId: params.traceId,
        stage: "orchestrator.catalog",
        decisionCode: "INTAKE_ASK_OIL_SPEC",
        durationMs: Date.now() - startedAt,
        metadata: {
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitando especificação do óleo para orçamento",
        silence: false,
      };
    }

    if (!isGenericBudgetRequest(ctx.messageContent)) {
      // Cliente já descreveu o problema; deixa a busca do catálogo seguir.
    } else {
    const followUp = "Certo. Qual seria o seu problema?";
    await options.sendMessage(ctx.conversationId, followUp);
    await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "intake_ask_issue",
      decision: "tool_then_ai",
      reason: "Cliente sinalizou orçamento; pedindo problema específico",
      traceId: params.traceId,
      stage: "orchestrator.catalog",
      decisionCode: "INTAKE_ASK_ISSUE",
      durationMs: Date.now() - startedAt,
      metadata: {
        messageContent: ctx.messageContent,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Solicitando detalhamento da necessidade",
      silence: false,
    };
    }
  }

  // Consulta determinística de catálogo (produtos/serviços) para perguntas de preço.
  // Só entra quando não há intenção clara de reservar horário.
  if (
    !looksLikeReservationIntent(ctx.messageContent) &&
    !containsDateOrTimeHint(ctx.messageContent) &&
    !looksLikeReservationConfirmation(ctx.messageContent)
  ) {
    if (shouldAskOilQualification(ctx.messageContent)) {
      const oilQualificationReply =
        "Pra te indicar o valor correto da troca, me confirma qual óleo você usa (ex.: 5W30, 10W40). Se não souber, eu já organizo um horário pra avaliação.";
      await options.sendMessage(ctx.conversationId, oilQualificationReply);
      if (intakeStage !== "awaiting_issue") {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
      }
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "catalog_need_oil_spec",
        decision: "tool_then_ai",
        reason: "Consulta de óleo sem especificação",
        traceId: params.traceId,
        stage: "orchestrator.catalog",
        decisionCode: "CATALOG_NEED_OIL_SPEC",
        durationMs: Date.now() - startedAt,
        metadata: {
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitando tipo de óleo antes de cotar",
        silence: false,
      };
    }

    const catalogQuery = buildCatalogQueryWithContext(ctx.messageContent, reservationContext);
    const catalog = await buildCatalogReply(ctx.organizationId, catalogQuery, {
      skipIntentCheck: intakeStage === "awaiting_issue" || intakeStage === "awaiting_need",
    });
    if (catalog) {
      await options.sendMessage(ctx.conversationId, catalog.reply);
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: catalog.selectedServiceName,
        productName: catalog.selectedProductName,
      });
      if (intakeStage) {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, null);
      }
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "catalog_quote_reply",
        decision: "tool_then_ai",
        reason: "Consulta de produtos/serviços respondida de forma determinística",
        traceId: params.traceId,
        stage: "orchestrator.catalog",
        decisionCode: "CATALOG_QUOTE_REPLY",
        durationMs: Date.now() - startedAt,
        metadata: {
          messageContent: ctx.messageContent,
          catalogQuery,
          productMatches: catalog.productMatches,
          serviceMatches: catalog.serviceMatches,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Orçamento de catálogo respondido",
        silence: false,
      };
    }

    const shouldClarifyCatalog =
      intakeStage === "awaiting_issue" ||
      looksLikeCatalogIntent(ctx.messageContent) ||
      (Boolean(reservationContext.serviceName || reservationContext.productName) &&
        /\b(valor|preco|quanto|troca|servico)\b/.test(normalizeForSearch(ctx.messageContent)));

    if (shouldClarifyCatalog) {
      const promptKey = "catalog:clarify_intent";
      const promptState = getCatalogPromptRepeatState(conversationMetadata, promptKey);
      await options.sendMessage(
        ctx.conversationId,
        buildCatalogClarificationReply(promptState.repeatCount)
      );
      await persistCatalogPromptState(
        ctx.conversationId,
        conversationMetadata,
        promptKey,
        promptState.nextCount
      );
      if (intakeStage !== "awaiting_issue") {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
      }
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "catalog_clarify_no_match",
        decision: "tool_then_ai",
        reason: "Consulta de catálogo sem match; solicitando clarificação",
        traceId: params.traceId,
        stage: "orchestrator.catalog",
        decisionCode: "CATALOG_CLARIFY_NO_MATCH",
        durationMs: Date.now() - startedAt,
        metadata: {
          messageContent: ctx.messageContent,
          catalogQuery,
          intakeStage,
          hasReservationContext: Boolean(
            reservationContext.serviceName || reservationContext.productName
          ),
          repeatCount: promptState.repeatCount,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Sem match no catálogo; pedindo clarificação da intenção",
        silence: false,
      };
    }

    if (getIntakeStage(conversationMetadata) === "awaiting_issue") {
      const fallbackReservation =
        "Entendi. Nesse caso, posso te ajudar com o agendamento para avaliarmos melhor. Me informe seu nome e os dados do veículo (modelo, ano e km).";
      await options.sendMessage(ctx.conversationId, fallbackReservation);
      await persistIntakeStage(
        ctx.conversationId,
        conversationMetadata,
        "awaiting_reservation_profile"
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "intake_fallback_to_reservation",
        decision: "tool_then_ai",
        reason: "Sem match no catálogo após detalhamento; migrando para reserva",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "INTAKE_FALLBACK_TO_RESERVATION",
        durationMs: Date.now() - startedAt,
        metadata: {
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Sem match no catálogo; iniciando coleta para agendamento",
        silence: false,
      };
    }
  }

  // Fluxo robusto de coleta de perfil para reservas em oficinas:
  // sempre que houver sinal de intenção de agendamento, coleta nome + dados do veículo
  // antes de avançar para confirmação de horário.
  if (ctx.reservationsEnabled && ctx.usesVehicleSlots) {
    const vehicleSlotsFromCurrent = extractVehicleSlotsFromText(ctx.messageContent);
    const hasVehicleInfoInCurrentMessage = Boolean(
      vehicleSlotsFromCurrent.modelo ||
        vehicleSlotsFromCurrent.ano ||
        vehicleSlotsFromCurrent.km
    );
    const hasReservationSignal =
      looksLikeReservationIntent(ctx.messageContent) ||
      !!ctx.pendingReservation ||
      hasVehicleInfoInCurrentMessage ||
      intakeStage === "awaiting_reservation_profile";

    if (hasReservationSignal && (missingNameProfile || missingVehicleProfile.length > 0)) {
      const parsedForPending =
        extractReservationDateTime(ctx.messageContent) ??
        (await findLatestInboundReservationDateTime(ctx.conversationId));
      await savePendingReservation(
        ctx.conversationId,
        conversationMetadata,
        parsedForPending
          ? {
              dateStr: parsedForPending.dateStr,
              timeStr: parsedForPending.timeStr,
              durationMinutes: 60,
            }
          : ctx.pendingReservation ?? null
      );
      const promptKey = buildProfilePromptKey(missingNameProfile, missingVehicleProfile);
      const promptState = getPromptRepeatState(conversationMetadata, promptKey);
      await options.sendMessage(
        ctx.conversationId,
        buildSmartMissingReservationProfileReply(
          missingNameProfile,
          missingVehicleProfile,
          promptState.repeatCount
        )
      );
      await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
        collectionStage: "collect_profile",
        lastPromptKey: promptKey,
        lastPromptRepeatCount: promptState.nextCount,
        slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
      });
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_collect_profile",
        decision: "tool_then_ai",
        reason: "Coletando nome e dados do veículo para continuidade da reserva",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_COLLECT_PROFILE",
        durationMs: Date.now() - startedAt,
        metadata: {
          missingName: missingNameProfile,
          missingVehicle: missingVehicleProfile,
          stage: inferCollectionStage(
            missingNameProfile,
            missingVehicleProfile,
            ctx.pendingReservation
          ),
          hasVehicleInfoInCurrentMessage,
          hasPendingReservation: !!ctx.pendingReservation,
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitando perfil obrigatório antes de reservar",
        silence: false,
      };
    }

    if (
      hasReservationSignal &&
      intakeStage === "awaiting_reservation_profile" &&
      !missingNameProfile &&
      missingVehicleProfile.length === 0
    ) {
      await persistIntakeStage(ctx.conversationId, conversationMetadata, null);
    }
  }

  // Se já existe horário pendente de confirmação e cliente confirmou, cria a reserva.
  if (ctx.reservationsEnabled && ctx.pendingReservation) {
    const pending = ctx.pendingReservation;
    const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
    const missingName = !contactName;

    if (!looksLikeReservationConfirmation(ctx.messageContent)) {
      if (missingName || missingVehicle.length > 0) {
        const promptKey = buildProfilePromptKey(missingName, missingVehicle);
        const promptState = getPromptRepeatState(conversationMetadata, promptKey);
        await options.sendMessage(
          ctx.conversationId,
          buildSmartMissingReservationProfileReply(
            missingName,
            missingVehicle,
            promptState.repeatCount
          )
        );
        await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
          collectionStage: "collect_profile",
          lastPromptKey: promptKey,
          lastPromptRepeatCount: promptState.nextCount,
          slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
        });
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
      await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
        collectionStage: "confirm_reservation",
        slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
      });
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
      const promptKey = buildProfilePromptKey(missingName, missingVehicle);
      const promptState = getPromptRepeatState(conversationMetadata, promptKey);
      await options.sendMessage(
        ctx.conversationId,
        buildSmartMissingReservationProfileReply(
          missingName,
          missingVehicle,
          promptState.repeatCount
        )
      );
      await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
        collectionStage: "collect_profile",
        lastPromptKey: promptKey,
        lastPromptRepeatCount: promptState.nextCount,
        slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
      });
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
      serviceName: reservationContext.serviceName,
      productName: reservationContext.productName,
    });
    const created = await createReservationForOrg(ctx.organizationId, {
      startAt,
      durationMinutes: pending.durationMinutes,
      contactId: ctx.contactId,
      serviceName: reservationContext.serviceName ?? undefined,
      productName: reservationContext.productName ?? undefined,
      notes: reservationNotes,
      source: "ai",
    });
    await savePendingReservation(ctx.conversationId, conversationMetadata, null);
    await persistReservationContext(ctx.conversationId, conversationMetadata, null);

    if (created?.success) {
      const friendlyDate = formatDateForPtBr(pending.dateStr);
      await options.sendMessage(
        ctx.conversationId,
        `Perfeito. Reserva confirmada para ${friendlyDate} às ${pending.timeStr}.`
      );
      await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
        collectionStage: "completed",
        slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
      });
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
    const vehicleSlotsFromCurrent = extractVehicleSlotsFromText(ctx.messageContent);
    const hasVehicleInfoInCurrentMessage = Boolean(
      vehicleSlotsFromCurrent.modelo ||
        vehicleSlotsFromCurrent.ano ||
        vehicleSlotsFromCurrent.km
    );
    const parsedFromHistory =
      !parsedCurrentMessage &&
      (
        looksLikeVehicleInfoMessage(ctx.messageContent) ||
        hasVehicleInfoInCurrentMessage ||
        justCapturedName ||
        intakeStage === "awaiting_reservation_profile"
      )
        ? await findLatestInboundReservationDateTime(ctx.conversationId)
        : null;
    const parsed = parsedCurrentMessage ?? parsedFromHistory;

    if (parsed) {
      if (missingNameProfile) {
        const promptKey = buildProfilePromptKey(true, []);
        const promptState = getPromptRepeatState(conversationMetadata, promptKey);
        await savePendingReservation(ctx.conversationId, conversationMetadata, {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          durationMinutes: 60,
        });
        await options.sendMessage(
          ctx.conversationId,
          buildSmartMissingReservationProfileReply(true, [], promptState.repeatCount)
        );
        await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
          collectionStage: "collect_profile",
          lastPromptKey: promptKey,
          lastPromptRepeatCount: promptState.nextCount,
          slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
        });
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
      if (missingNameProfile) {
        const promptKey = buildProfilePromptKey(true, []);
        const promptState = getPromptRepeatState(conversationMetadata, promptKey);
        await options.sendMessage(
          ctx.conversationId,
          buildSmartMissingReservationProfileReply(true, [], promptState.repeatCount)
        );
        await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
          collectionStage: "collect_profile",
          lastPromptKey: promptKey,
          lastPromptRepeatCount: promptState.nextCount,
          slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
        });
        await logOrchestration({
          conversationId: ctx.conversationId,
          organizationId: ctx.organizationId,
          event: "reservation_collect_missing_name",
          decision: "tool_then_ai",
          reason: "Dados do veículo completos, mas nome do cliente ainda não informado",
          traceId: params.traceId,
          stage: "orchestrator.reservations",
          decisionCode: "RESERVATION_COLLECT_MISSING_NAME",
          durationMs: Date.now() - startedAt,
          metadata: {
            vehicleSlots: ctx.vehicleSlots,
            messageContent: ctx.messageContent,
          },
        });
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Solicitou nome antes de pedir data/horário",
          silence: false,
        };
      }

      const reply =
        "Posso consultar a disponibilidade e já reservar um horário para você. Qual data e horário prefere?";
      await options.sendMessage(ctx.conversationId, reply);
      await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
        collectionStage: "collect_datetime",
        slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
      });
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
        const promptKey = buildProfilePromptKey(missingNameProfile, missingVehicleProfile);
        const promptState = getPromptRepeatState(conversationMetadata, promptKey);
        await savePendingReservation(ctx.conversationId, conversationMetadata, {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          durationMinutes: 60,
        });
        await options.sendMessage(
          ctx.conversationId,
          buildSmartMissingReservationProfileReply(
            missingNameProfile,
            missingVehicleProfile,
            promptState.repeatCount
          )
        );
        await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
          collectionStage: "collect_profile",
          lastPromptKey: promptKey,
          lastPromptRepeatCount: promptState.nextCount,
          slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
        });
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
      const parsedForPending =
        extractReservationDateTime(ctx.messageContent) ??
        (await findLatestInboundReservationDateTime(ctx.conversationId));
      await savePendingReservation(
        ctx.conversationId,
        conversationMetadata,
        parsedForPending
          ? {
              dateStr: parsedForPending.dateStr,
              timeStr: parsedForPending.timeStr,
              durationMinutes: 60,
            }
          : ctx.pendingReservation ?? null
      );
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

    // Continuidade da coleta: se há reserva pendente ou a mensagem parece ser
    // dado de veículo (ex: "onix"), não pode cair em silêncio.
    const vehicleSlotsFromCurrent = extractVehicleSlotsFromText(ctx.messageContent);
    const hasVehicleInfoInCurrentMessage = Boolean(
      vehicleSlotsFromCurrent.modelo ||
        vehicleSlotsFromCurrent.ano ||
        vehicleSlotsFromCurrent.km
    );
    if (
      missing.length > 0 &&
      (
        ctx.pendingReservation ||
        looksLikeVehicleInfoMessage(ctx.messageContent) ||
        hasVehicleInfoInCurrentMessage
      )
    ) {
      await options.sendMessage(
        ctx.conversationId,
        buildMissingVehicleInfoReply(missing)
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_collect_missing_vehicle_info_progress",
        decision: "tool_then_ai",
        reason: "Continuidade da coleta de dados do veículo",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_COLLECT_MISSING_VEHICLE_INFO_PROGRESS",
        durationMs: Date.now() - startedAt,
        metadata: {
          missingSlots: missing,
          vehicleSlots: slots,
          hasPendingReservation: !!ctx.pendingReservation,
          pendingReservation: ctx.pendingReservation ?? null,
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitando continuidade dos dados do veículo",
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
      const parsedForPending =
        extractReservationDateTime(ctx.messageContent) ??
        (await findLatestInboundReservationDateTime(ctx.conversationId));
      await savePendingReservation(
        ctx.conversationId,
        conversationMetadata,
        parsedForPending
          ? {
              dateStr: parsedForPending.dateStr,
              timeStr: parsedForPending.timeStr,
              durationMinutes: 60,
            }
          : ctx.pendingReservation ?? null
      );
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

    const parsedFromCurrent = extractReservationDateTime(ctx.messageContent);
    const parsed =
      parsedFromCurrent ??
      (!containsDateOrTimeHint(ctx.messageContent)
        ? await findLatestInboundReservationDateTime(ctx.conversationId)
        : null);

    if (parsed) {
      if (missingNameProfile || missing.length > 0) {
        const promptKey = buildProfilePromptKey(missingNameProfile, missing);
        const promptState = getPromptRepeatState(conversationMetadata, promptKey);
        await savePendingReservation(ctx.conversationId, conversationMetadata, {
          dateStr: parsed.dateStr,
          timeStr: parsed.timeStr,
          durationMinutes: 60,
        });
        await options.sendMessage(
          ctx.conversationId,
          buildSmartMissingReservationProfileReply(
            missingNameProfile,
            missing,
            promptState.repeatCount
          )
        );
        await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
          collectionStage: "collect_profile",
          lastPromptKey: promptKey,
          lastPromptRepeatCount: promptState.nextCount,
          slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
        });
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

  // Fallback determinístico de entrada:
  // com useAsFallback=false, mensagens iniciais (ex: "oi") não podem ficar sem resposta.
  if (
    ctx.reservationsEnabled &&
    !ctx.aiAgentUseAsFallback &&
    !containsDateOrTimeHint(ctx.messageContent) &&
    looksLikeGreeting(ctx.messageContent)
  ) {
    await options.sendMessage(
      ctx.conversationId,
      "Olá! Posso consultar a disponibilidade e já reservar um horário para você. Qual data e horário prefere?"
    );
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "reservation_entry_prompt",
      decision: "tool_then_ai",
      reason: "Saudação recebida com fallback IA desativado",
      traceId: params.traceId,
      stage: "orchestrator.reservations",
      decisionCode: "RESERVATION_ENTRY_PROMPT",
      durationMs: Date.now() - startedAt,
      metadata: {
        aiAgentUseAsFallback: ctx.aiAgentUseAsFallback,
        messageContent: ctx.messageContent,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Resposta inicial determinística enviada",
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
