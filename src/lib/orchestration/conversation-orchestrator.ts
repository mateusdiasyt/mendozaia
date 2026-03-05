/**
 * Orquestrador de conversa - camada central que controla o fluxo.
 * A IA nunca responde diretamente ao webhook sem passar por aqui.
 */

import { db } from "@/lib/db";
import {
  conversations,
  organizations,
  messages,
  contacts,
  productCategories,
  products,
  services,
} from "@/lib/db/schema";
import { eq, desc, and, gt, lt, asc } from "drizzle-orm";
import { logOrchestration } from "./logger";
import { filterResponse } from "./response-filter";
import { handoffToHuman } from "./handoff";
import { generateAIReply, type CustomerContext } from "@/lib/ai-agent";
import {
  findRelevantExamples,
  incrementUsageCount,
  setLastUsedExampleIds,
  clearLastUsedExampleIds,
} from "@/lib/ai-training";
import {
  findRelevantFAQ,
  incrementFaqUsage,
  setLastUsedFaqId,
  clearLastUsedFaqId,
} from "@/lib/faq-engine";
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
import {
  getRandomNameQuestion,
  getRandomContinuationNameQuestion,
} from "@/lib/conversation-engine/humanize";
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
  /** Contexto do cliente (perfil + memória) - injetado no prompt da IA */
  customerContext?: CustomerContext | null;
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

function detectGreetingFromText(text: string): "bom_dia" | "boa_tarde" | "boa_noite" | "oi" | null {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.includes("bom dia")) return "bom_dia";
  if (t.includes("boa tarde")) return "boa_tarde";
  if (t.includes("boa noite")) return "boa_noite";
  if (t.startsWith("oi") || t.startsWith("ola") || t.startsWith("opa") || t.startsWith("e ai")) {
    return "oi";
  }
  return null;
}

function getHourInTimezone(now: Date, timezone?: string): number {
  if (!timezone) return now.getHours();
  try {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(now);
    const hour = Number(hourStr);
    return Number.isFinite(hour) ? hour : now.getHours();
  } catch {
    return now.getHours();
  }
}

function getCurrentGreeting(
  now: Date,
  timezone?: string
): "bom_dia" | "boa_tarde" | "boa_noite" {
  const hour = getHourInTimezone(now, timezone);
  if (hour < 12) return "bom_dia";
  if (hour < 18) return "boa_tarde";
  return "boa_noite";
}

function buildAdaptiveGreeting(text: string, now: Date, timezone?: string): string {
  const requested = detectGreetingFromText(text);
  const current = getCurrentGreeting(now, timezone);
  const active = requested && requested !== "oi" ? requested : current;
  const greetingKey = active === current ? active : current;
  const variants: Record<"bom_dia" | "boa_tarde" | "boa_noite", string[]> = {
    bom_dia: ["Bom dia!", "Olá, bom dia!", "Bom dia, tudo bem?"],
    boa_tarde: ["Boa tarde!", "Olá, boa tarde!", "Boa tarde, tudo bem?"],
    boa_noite: ["Boa noite!", "Olá, boa noite!", "Boa noite, tudo bem?"],
  };
  const minute = getHourInTimezone(now, timezone) * 60 + now.getMinutes();
  const selected = variants[greetingKey][minute % variants[greetingKey].length];
  return selected;
}

function applyToneToText(
  text: string,
  tone?: "formal" | "neutro" | "casual"
): string {
  if (tone === "formal") {
    return text
      .replace(/\bPrazer\b/g, "Prazer em atendê-lo")
      .replace(/\bqual sua dúvida\?/gi, "como posso ajudar?");
  }
  if (tone === "casual") {
    return text
      .replace(/\bQual é o seu nome\?/g, "Como você se chama?")
      .replace(/\bAgora me diga: qual é a sua dúvida\?/g, "Me conta rapidinho qual é sua dúvida?");
  }
  return text;
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
  return (
    /\b(sabe|lembra|entendeu|tem|tenho)\b.*\b(carro|veiculo|modelo)\b/.test(t) ||
    /\b(qual|que)\b.*\b(carro|veiculo|modelo)\b.*\b(tenho|ta|esta|cadastrado)\b/.test(t) ||
    /\b(meu carro|meu veiculo|veiculo cadastrado|dados do carro)\b/.test(t)
  );
}

function looksLikeVehicleUpdateRequest(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\b(alterar|atualizar|trocar|corrigir|mudar)\b.*\b(carro|veiculo|modelo|ano|km)\b/.test(t);
}

function looksLikeAskInstagram(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\b(insta|instagram|rede social)\b/.test(t);
}

function looksLikeAskAddress(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /\b(endereco|localizacao|localizacao|onde fica|mapa|google maps)\b/.test(t);
}

function looksLikeAskBotName(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    /\b(qual|como)\b.*\b(seu nome|nome do bot|nome)\b/.test(t) ||
    /\bquem (e|é) voce\b/.test(t) ||
    /\bse chama\b/.test(t)
  );
}

function looksLikeVehicleStatusInquiry(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    /\b(situacao|status|andamento|atualizacao|atualização)\b.*\b(carro|veiculo)\b/.test(t) ||
    /\b(carro|veiculo)\b.*\b(pronto|ficou pronto|ja esta pronto|ja ta pronto)\b/.test(t) ||
    /\b(como|qual)\b.*\b(meu carro|veiculo)\b/.test(t)
  );
}

function looksLikeCarProblemOrRepairIntent(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const hasVehicleHint =
    /\b(carro|veiculo|motor|suspensao|freio|direcao|embreagem|injecao)\b/.test(t) ||
    /\b(19[89]\d|20[0-3]\d)\b/.test(t) ||
    /\b(ford|fiat|gm|chevrolet|vw|volkswagen|toyota|honda|hyundai|renault|peugeot|citroen|nissan|jeep)\b/.test(
      t
    );
  const hasSymptom =
    /\b(barulho|ruido|ruído|estranho|problema|defeito|falha|vibrando|tremendo|rangendo)\b/.test(
      t
    );
  return (
    /\b(barulho|ruido|ruído|estranho|problema|defeito)\b.*\b(carro|veiculo)\b/.test(t) ||
    /\b(carro|veiculo)\b.*\b(barulho|ruido|ruído|estranho|problema|defeito)\b/.test(t) ||
    /\b(verificar|verificacao|verificação|checar|checagem)\b.*\b(carro|veiculo)\b/.test(t) ||
    /\b(quero fazer verificar|preciso verificar|gostaria de verificar)\b/.test(t) ||
    /\b(fazer|levar)\b.*\b(verificar|checar)\b/.test(t) ||
    (hasVehicleHint && hasSymptom)
  );
}

function looksLikeDirectHumanMechanicalIssue(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hasVehicleContext =
    /\b(carro|veiculo|motor|freio|embreagem|direcao|suspensao|radiador|injecao|bateria|painel)\b/.test(
      t
    ) ||
    /\b(19[89]\d|20[0-3]\d)\b/.test(t) ||
    /\b(ford|fiat|gm|chevrolet|vw|volkswagen|toyota|honda|hyundai|renault|peugeot|citroen|nissan|jeep)\b/.test(
      t
    );

  const criticalPatterns = [
    /\b(nao liga|apagou|morreu do nada|pane)\b/,
    /\b(superaquecendo|ferveu|motor aquecendo)\b/,
    /\b(fumaca|fumacando|fumaciando)\b/,
    /\b(perdeu potencia|sem forca|falta forca)\b/,
    /\b(freio falhou|sem freio|freio ruim)\b/,
    /\b(vazando oleo|vazamento|vazando agua)\b/,
  ];

  if (criticalPatterns.some((pattern) => pattern.test(t))) {
    return true;
  }

  const symptomPatterns = [
    /\b(barulho|ruido|batendo|vibrando|tremendo)\b/,
    /\b(falha|falhando|engasgando|engasgo)\b/,
    /\b(bico|vela|bobina|injecao)\b/,
    /\b(parte de motor|motor|cabecote|retifica|cambio)\b/,
    /\b(cheiro estranho|cheiro forte|cheiro de queimado)\b/,
    /\b(luz do painel|luz de injecao|check engine|alerta no painel)\b/,
    /\b(defeito|problema mecanico|problema tecnico)\b/,
    /\b(diagnostico|verificar)\b/,
  ];

  const symptomHits = symptomPatterns.reduce(
    (count, pattern) => (pattern.test(t) ? count + 1 : count),
    0
  );

  return (hasVehicleContext && symptomHits >= 1) || symptomHits >= 2;
}

function formatVehicleForNaturalSpeech(slots: VehicleSlots | undefined): string {
  if (!slots) return "";
  const parts: string[] = [];
  if (slots.modelo) parts.push(slots.modelo);
  if (slots.ano) parts.push(String(slots.ano));
  if (slots.km) {
    const km = slots.km;
    const kmStr = km >= 1000 ? `${Math.round(km / 1000)} mil km` : `${km} km`;
    parts.push(`com ${kmStr}`);
  }
  return parts.join(" ");
}

function buildVehicleSignature(slots: VehicleSlots | undefined): string {
  if (!slots) return "";
  const modelo = (slots.modelo ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const ano = slots.ano ? String(slots.ano) : "";
  const km = slots.km ? String(slots.km) : "";
  return `${modelo}|${ano}|${km}`;
}

function normalizeVehicleModelKey(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const KNOWN_BRANDS = [
  "fiat",
  "ford",
  "chevrolet",
  "gm",
  "volkswagen",
  "vw",
  "toyota",
  "honda",
  "hyundai",
  "renault",
  "peugeot",
  "citroen",
  "nissan",
  "jeep",
  "mitsubishi",
  "kia",
  "bmw",
  "audi",
  "mercedes",
];

function prettifyVehicleLabel(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function looksLikeVehicleCoverageQuestion(text: string): boolean {
  const t = normalizeForSearch(text);
  return (
    /\b(voces|você|vc|vocês)\b.*\b(atende|atendem|aceita|aceitam)\b/.test(t) ||
    /\b(atende|atendem|aceita|aceitam)\b.*\b(carro|veiculo|modelo|marca)\b/.test(t) ||
    /\b(quais|qual)\b.*\b(carros|modelos|anos)\b.*\b(atende|atendem|aceita|aceitam)\b/.test(t)
  );
}

function looksLikeServiceCoverageQuestion(text: string): boolean {
  const t = normalizeForSearch(text);
  return (
    /\b(voces|você|vc|vocês)\b.*\b(faz|fazem|trabalha|trabalham|atende|atendem)\b/.test(t) ||
    /\b(faz|fazem|trabalha|trabalham|atende|atendem)\b.*\b(isso|esse|servico|serviço|parte)\b/.test(
      t
    )
  );
}

function normalizeServiceLabel(value: string): string {
  return normalizeForSearch(value)
    .replace(/\b(servico|serviço|de|do|da|para|pra)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectAskedOfferedService(
  text: string,
  offeredServices: string[]
): string | null {
  const normalizedText = normalizeForSearch(text);
  if (!normalizedText) return null;

  const sorted = [...offeredServices].sort((a, b) => b.length - a.length);
  for (const service of sorted) {
    const normalizedService = normalizeServiceLabel(service);
    if (!normalizedService) continue;
    if (normalizedText.includes(normalizedService)) {
      return service;
    }
  }

  const tokens = normalizedText
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  if (tokens.length === 0) return null;

  let best: { service: string; score: number } | null = null;
  for (const service of sorted) {
    const normalizedService = normalizeServiceLabel(service);
    if (!normalizedService) continue;
    const score = tokens.reduce(
      (acc, token) => (normalizedService.includes(token) ? acc + 1 : acc),
      0
    );
    if (score >= 2 || (tokens.length === 1 && score >= 1)) {
      if (!best || score > best.score) {
        best = { service, score };
      }
    }
  }
  return best?.service ?? null;
}

function extractBrandMention(text: string): string | null {
  const t = normalizeForSearch(text);
  for (const brand of KNOWN_BRANDS) {
    const regex = new RegExp(`\\b${brand}\\b`, "i");
    if (regex.test(t)) {
      return brand;
    }
  }
  return null;
}

function buildVehiclePolicySummaryText(policy: {
  minAllowedYear?: number | null;
  blockedModels?: string[];
  blockedModelYears?: Array<{ model: string; year?: number | null }>;
}): string {
  const chunks: string[] = [];
  if (policy.minAllowedYear) {
    chunks.push(`Atendemos veículos a partir de *${policy.minAllowedYear}*.`);
  } else {
    chunks.push("Atendemos veículos de diferentes anos, conforme avaliação da oficina.");
  }

  const blockedModels = (policy.blockedModels ?? [])
    .map((model) => normalizeVehicleModelKey(model))
    .filter(Boolean);
  if (blockedModels.length > 0) {
    const preview = blockedModels.slice(0, 6).map((model) => prettifyVehicleLabel(model));
    const moreCount = blockedModels.length - preview.length;
    const suffix = moreCount > 0 ? ` e mais ${moreCount}` : "";
    chunks.push(`Exceções por modelo: *${preview.join(", ")}*${suffix}.`);
  }

  const blockedModelYears = (policy.blockedModelYears ?? [])
    .map((item) => ({
      model: normalizeVehicleModelKey(item.model),
      year: typeof item.year === "number" ? item.year : null,
    }))
    .filter((item) => !!item.model && !!item.year);
  if (blockedModelYears.length > 0) {
    const preview = blockedModelYears
      .slice(0, 4)
      .map((item) => `${prettifyVehicleLabel(item.model)} ${item.year}`);
    const moreCount = blockedModelYears.length - preview.length;
    const suffix = moreCount > 0 ? ` e mais ${moreCount}` : "";
    chunks.push(`Exceções por ano/modelo: *${preview.join(", ")}*${suffix}.`);
  }

  chunks.push("Se quiser, me diga *modelo e ano* que eu confirmo na hora pra você.");
  return chunks.join("\n");
}

function evaluateVehicleServicePolicy(
  policy:
    | {
        minAllowedYear?: number | null;
        blockedModels?: string[];
        blockedModelYears?: Array<{ model: string; year?: number | null }>;
      }
    | undefined,
  slots: VehicleSlots | undefined
): { blocked: boolean; reason: string | null } {
  if (!policy || !slots) return { blocked: false, reason: null };

  const minAllowedYear =
    typeof policy.minAllowedYear === "number" ? policy.minAllowedYear : null;
  const normalizedModel = normalizeVehicleModelKey(slots.modelo);

  if (minAllowedYear && slots.ano && slots.ano < minAllowedYear) {
    return {
      blocked: true,
      reason: `No momento, atendemos veículos a partir do ano *${minAllowedYear}*.`,
    };
  }

  const blockedModelsNormalized = new Set(
    (policy.blockedModels ?? []).map((model) => normalizeVehicleModelKey(model))
  );
  if (normalizedModel && blockedModelsNormalized.has(normalizedModel)) {
    return {
      blocked: true,
      reason: `No momento, não atendemos o modelo *${slots.modelo}*.`,
    };
  }

  const blockedModelYears = policy.blockedModelYears ?? [];
  if (normalizedModel && slots.ano) {
    const matchedModelYear = blockedModelYears.find((item) => {
      const itemModel = normalizeVehicleModelKey(item.model);
      const itemYear = typeof item.year === "number" ? item.year : null;
      return itemModel === normalizedModel && itemYear === slots.ano;
    });
    if (matchedModelYear) {
      return {
        blocked: true,
        reason: `No momento, não atendemos *${slots.modelo} ${slots.ano}*.`,
      };
    }
  }

  return { blocked: false, reason: null };
}

const VEHICLE_CONFIRMATION_STALE_MS = 24 * 60 * 60 * 1000; // 24h
const INTENT_STITCH_WINDOW_MS = 15 * 1000; // 15s
const INTENT_STITCH_MAX_MESSAGES = 3;
const INTENT_STITCH_MAX_CHARS = 280;
const INBOUND_BLOCK_MAX_MESSAGES = 12;
const INBOUND_BLOCK_MAX_CHARS = 700;
const NAME_PROMPT_REPEAT_WINDOW_MS = 45 * 1000; // 45s
const FLOW_RESUME_TIMEOUT_MS = 45 * 60 * 1000; // 45min
const INVALID_NAME_TERMS = new Set([
  "oi",
  "ola",
  "ok",
  "sim",
  "nao",
  "não",
  "quero",
  "confirmo",
  "amanha",
  "hoje",
  "entao",
  "então",
  "tipo",
  "pirulito",
  "carro",
  "veiculo",
  "veículo",
  "modelo",
  "ano",
  "km",
  "quilometragem",
  "onix",
  "gol",
  "hb20",
  "civic",
  "corolla",
]);

function isSimpleAffirmative(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return /^(sim|isso|correto|perfeito|ok|blz|beleza|pode ser|confirmo)$/.test(t);
}

function isSimpleNegative(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(nao|negativo|errado|nao sei)\b/.test(t);
}

function looksLikeVehicleDidNotChange(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /\b(nao mudei|nao mudou|continua|continua o mesmo|o mesmo|mesmo carro)\b/.test(t) ||
    /^(nao|não)$/.test(t)
  );
}

function looksLikeVehicleChanged(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .trim();
  return /\b(sim|mudei|mudou|troquei|tenho outro|outro carro)\b/.test(t);
}

function looksLikeUnknownKm(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /\b(nao sei|desconheco|nao lembro|sem km)\b/.test(t) &&
    /\b(km|quilometragem|odometro|odometro)\b/.test(t)
  );
}

function looksLikeGenericFlowMessage(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /^(ok|entendi|blz|beleza|sim|isso|certo|show|perfeito|pode ser)$/.test(t) ||
    /^quais?\s+dados\??$/.test(t) ||
    /^que\s+dados\??$/.test(t) ||
    /^como\s+assim\??$/.test(t)
  );
}

function looksLikeContinueFlowChoice(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(continuar|continua|seguir|prosseguir|retomar|pode continuar)\b/.test(t);
}

function looksLikeRestartFlowChoice(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(novo atendimento|novo|reiniciar|recomecar|recomecar|do zero)\b/.test(t);
}

function hasActiveConversationFlowState(state: string | null | undefined): boolean {
  return (
    state === CONVERSATION_STATES.COLLECTING_INFO ||
    state === CONVERSATION_STATES.AWAITING_SYSTEM ||
    state === CONVERSATION_STATES.READY_TO_CONFIRM
  );
}

async function buildIntentProbeText(
  conversationId: string,
  currentMessage: string
): Promise<string> {
  const fallback = currentMessage.trim();
  if (!fallback) return currentMessage;

  const [lastOutbound] = await db
    .select({
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (lastOutbound?.createdAt) {
    const inboundSinceLastReply = await db
      .select({
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          gt(messages.createdAt, lastOutbound.createdAt)
        )
      )
      .orderBy(asc(messages.createdAt))
      .limit(INBOUND_BLOCK_MAX_MESSAGES);

    const stitchedBlock = inboundSinceLastReply
      .map((m) => (m.content ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (stitchedBlock) {
      // Se a resposta é curta (ex: só "Mateus") e pode ter perdido contexto (problema descrito antes do bot perguntar nome),
      // incluir inbound dos últimos 2 min antes do último reply para preservar intenção
      const SHORT_RESPONSE_THRESHOLD = 35;
      const CONTEXT_LOOKBACK_MS = 2 * 60 * 1000;
      if (stitchedBlock.length <= SHORT_RESPONSE_THRESHOLD) {
        const cutoff = new Date(lastOutbound.createdAt.getTime() - CONTEXT_LOOKBACK_MS);
        const inboundBeforeReply = await db
          .select({ content: messages.content })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              eq(messages.direction, "inbound"),
              gt(messages.createdAt, cutoff),
              lt(messages.createdAt, lastOutbound.createdAt)
            )
          )
          .orderBy(asc(messages.createdAt))
          .limit(6);
        const beforeBlock = inboundBeforeReply
          .map((m) => (m.content ?? "").trim())
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (beforeBlock) {
          const fullContext = `${beforeBlock} ${stitchedBlock}`.replace(/\s+/g, " ").trim();
          return fullContext.length > INBOUND_BLOCK_MAX_CHARS
            ? fullContext.slice(-INBOUND_BLOCK_MAX_CHARS)
            : fullContext;
        }
      }
      return stitchedBlock.length > INBOUND_BLOCK_MAX_CHARS
        ? stitchedBlock.slice(-INBOUND_BLOCK_MAX_CHARS)
        : stitchedBlock;
    }
  }

  const recent = await db
    .select({
      direction: messages.direction,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(8);

  const inbound = recent.filter(
    (m): m is { direction: string; content: string; createdAt: Date } =>
      m.direction === "inbound" && !!m.content?.trim() && !!m.createdAt
  );
  if (inbound.length <= 1) return fallback;

  const newestTs = inbound[0].createdAt.getTime();
  const stitched = inbound
    .filter((m, idx) => {
      if (idx >= INTENT_STITCH_MAX_MESSAGES) return false;
      return newestTs - m.createdAt.getTime() <= INTENT_STITCH_WINDOW_MS;
    })
    .reverse()
    .map((m) => m.content.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stitched) return fallback;
  return stitched.length > INTENT_STITCH_MAX_CHARS
    ? stitched.slice(-INTENT_STITCH_MAX_CHARS)
    : stitched;
}

async function shouldOfferFlowResumeChoice(conversationId: string): Promise<boolean> {
  const inbound = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "inbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(2);
  if (inbound.length < 2) return false;
  const latest = inbound[0]?.createdAt;
  const previous = inbound[1]?.createdAt;
  if (!latest || !previous) return false;
  return latest.getTime() - previous.getTime() >= FLOW_RESUME_TIMEOUT_MS;
}

async function shouldSuppressRepeatedNamePrompt(
  conversationId: string,
  _intentProbeText: string,
  explicitNameIntro: boolean
): Promise<boolean> {
  if (explicitNameIntro) return false;

  const [lastOutbound] = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (!lastOutbound?.content) return false;
  const isRecent =
    Date.now() - lastOutbound.createdAt.getTime() <=
    NAME_PROMPT_REPEAT_WINDOW_MS;
  const asksName =
    /qual\s+(?:e|é)\s+o\s+seu\s+nome\??/i.test(lastOutbound.content) ||
    /qual\s+seria\s+o\s+seu\s+nome\??/i.test(lastOutbound.content);

  return isRecent && asksName;
}

async function wasRecentNamePrompt(conversationId: string): Promise<boolean> {
  const [lastOutbound] = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (!lastOutbound?.content) return false;
  const isRecent = Date.now() - lastOutbound.createdAt.getTime() <= 5 * 60 * 1000;
  if (!isRecent) return false;
  return (
    /qual\s+(?:e|é)\s+o\s+seu\s+nome\??/i.test(lastOutbound.content) ||
    /qual\s+seria\s+o\s+seu\s+nome\??/i.test(lastOutbound.content)
  );
}

async function shouldSuppressRepeatedNeedPrompt(
  conversationId: string,
  nextPrompt: string,
  windowMs: number = 45_000
): Promise<boolean> {
  const [lastOutbound] = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (!lastOutbound?.content || !lastOutbound?.createdAt) return false;
  const isRecent = Date.now() - lastOutbound.createdAt.getTime() <= windowMs;
  if (!isRecent) return false;

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  return normalize(lastOutbound.content) === normalize(nextPrompt);
}

function looksLikeVehicleCorrectionDuringOilFlow(
  text: string,
  knownModel?: string
): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\b(nao|negativo|errado)\b/.test(t)) return false;
  if (/\b(oleo|lubrificante|viscosidade|nao sei)\b/.test(t)) return false;

  const knownModelNormalized = (knownModel ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    /\b(carro|veiculo|modelo)\b/.test(t) ||
    /\bnao\s+(e|eh|seria)\b/.test(t) ||
    (!!knownModelNormalized && t.includes(knownModelNormalized))
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

function normalizeTimeToHalfHour(hour: number, minute: number): { hour: number; minute: number } {
  const total = hour * 60 + minute;
  const nearestSlot = Math.round(total / 30) * 30;
  const normalizedHour = Math.floor((nearestSlot % (24 * 60)) / 60);
  const normalizedMinute = nearestSlot % 60;
  return { hour: normalizedHour, minute: normalizedMinute };
}

function ceilDateToNextHalfHour(base: Date): Date {
  const d = new Date(base);
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  if (minutes === 0 || minutes === 30) return d;
  const nextSlot = Math.ceil(minutes / 30) * 30;
  if (nextSlot >= 60) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  } else {
    d.setMinutes(nextSlot, 0, 0);
  }
  return d;
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
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const date = extractDate(text, now);
  const time = extractTime(text);
  if (date && time) {
    const normalizedTime = normalizeTimeToHalfHour(time.hour, time.minute);
    return {
      dateStr: toDateStr(date.year, date.month, date.day),
      timeStr: toTimeStr(normalizedTime.hour, normalizedTime.minute),
    };
  }

  // "agora" => usa próximo horário encaixado em grade de 30 minutos (:00 ou :30)
  if (/\bagora\b/.test(normalized)) {
    const immediate = ceilDateToNextHalfHour(now);
    return {
      dateStr: toDateStr(
        immediate.getFullYear(),
        immediate.getMonth() + 1,
        immediate.getDate()
      ),
      timeStr: toTimeStr(immediate.getHours(), immediate.getMinutes()),
    };
  }

  // Horário sem data explícita (ex.: "às 14h") -> assume hoje; se já passou, amanhã
  if (!date && time) {
    const normalizedTime = normalizeTimeToHalfHour(time.hour, time.minute);
    const tentative = new Date(now);
    tentative.setHours(normalizedTime.hour, normalizedTime.minute, 0, 0);
    if (tentative.getTime() <= now.getTime()) {
      tentative.setDate(tentative.getDate() + 1);
    }
    return {
      dateStr: toDateStr(
        tentative.getFullYear(),
        tentative.getMonth() + 1,
        tentative.getDate()
      ),
      timeStr: toTimeStr(normalizedTime.hour, normalizedTime.minute),
    };
  }

  if (!date || !time) return null;
  return {
    dateStr: toDateStr(date.year, date.month, date.day),
    timeStr: toTimeStr(time.hour, time.minute),
  };
}

function extractReservationDateOnly(
  text: string,
  now: Date = new Date()
): { dateStr: string } | null {
  const date = extractDate(text, now);
  const time = extractTime(text);
  if (!date || time) return null;
  return {
    dateStr: toDateStr(date.year, date.month, date.day),
  };
}

function detectReservationPeriod(text: string): "morning" | "afternoon" | null {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(manha|de manha|pela manha)\b/.test(t)) return "morning";
  if (/\b(tarde|de tarde|pela tarde)\b/.test(t)) return "afternoon";
  return null;
}

function timeToMinutes(timeStr: string): number {
  const [hour, minute] = timeStr.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return hour * 60 + minute;
}

function isReservationTimeAllowed(
  timeStr: string,
  schedule?: { start: string; end: string }
): boolean {
  const [hour, minute] = timeStr.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const startMinutes = timeToMinutes(schedule?.start ?? "09:00");
  const endMinutes = timeToMinutes(schedule?.end ?? "17:00");
  if (startMinutes < 0 || endMinutes < 0 || endMinutes <= startMinutes) {
    return false;
  }
  const appointmentStart = hour * 60 + minute;
  const appointmentEnd = appointmentStart + 60;
  if (appointmentStart < startMinutes) return false;
  if (appointmentEnd > endMinutes) return false;
  if (minute < 0 || minute > 59) return false;
  return true;
}

type ReservationPeriodSelection = {
  dateStr: string;
  period?: "morning" | "afternoon";
};

function getReservationPeriodSelection(
  metadata: Record<string, unknown>
): ReservationPeriodSelection | null {
  const flow = (metadata.reservationPeriodFlow as Record<string, unknown> | undefined) ?? {};
  const dateStr = typeof flow.dateStr === "string" ? flow.dateStr : null;
  if (!dateStr) return null;
  const period =
    flow.period === "morning" || flow.period === "afternoon"
      ? (flow.period as "morning" | "afternoon")
      : undefined;
  return { dateStr, period };
}

type RestaurantReservationFlow = {
  dateStr?: string;
  timeStr?: string;
  peopleCount?: number;
  collectionStage?: string;
};

function getRestaurantReservationFlow(
  metadata: Record<string, unknown>
): RestaurantReservationFlow | null {
  const flow = (metadata.restaurantReservationFlow as Record<string, unknown> | undefined) ?? {};
  const dateStr = typeof flow.dateStr === "string" ? flow.dateStr : undefined;
  const timeStr = typeof flow.timeStr === "string" ? flow.timeStr : undefined;
  const peopleCount =
    typeof flow.peopleCount === "number" && flow.peopleCount >= 1
      ? flow.peopleCount
      : undefined;
  const collectionStage = typeof flow.collectionStage === "string" ? flow.collectionStage : undefined;
  if (!dateStr && !timeStr && !peopleCount && !collectionStage) return null;
  return { dateStr, timeStr, peopleCount, collectionStage };
}

async function persistRestaurantReservationFlow(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  payload: Partial<RestaurantReservationFlow> | null
): Promise<void> {
  const nextMetadata = { ...currentMetadata };
  if (payload && Object.keys(payload).length > 0) {
    const current = (currentMetadata.restaurantReservationFlow as Record<string, unknown>) ?? {};
    nextMetadata.restaurantReservationFlow = { ...current, ...payload };
  } else {
    delete nextMetadata.restaurantReservationFlow;
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

async function persistReservationPeriodSelection(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  payload: ReservationPeriodSelection | null
): Promise<void> {
  const nextMetadata = { ...currentMetadata };
  if (payload?.dateStr) {
    nextMetadata.reservationPeriodFlow = {
      dateStr: payload.dateStr,
      period: payload.period ?? null,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMetadata.reservationPeriodFlow;
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

async function findAvailableSlotsForPeriod(
  organizationId: string,
  dateStr: string,
  period: "morning" | "afternoon",
  now: Date,
  schedule?: { start: string; end: string }
): Promise<string[]> {
  const startMinutes = timeToMinutes(schedule?.start ?? "09:00");
  const endMinutes = timeToMinutes(schedule?.end ?? "17:00");
  if (startMinutes < 0 || endMinutes <= startMinutes) return [];

  const candidateMinutes: number[] = [];
  for (let mins = startMinutes; mins + 60 <= endMinutes; mins += 60) {
    const hour = Math.floor(mins / 60);
    if (period === "morning" && hour > 12) continue;
    if (period === "afternoon" && hour < 13) continue;
    candidateMinutes.push(mins);
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const sameDay =
    now.getFullYear() === year &&
    now.getMonth() + 1 === month &&
    now.getDate() === day;

  const available: string[] = [];
  for (const mins of candidateMinutes) {
    const hour = Math.floor(mins / 60);
    const minute = mins % 60;
    if (sameDay) {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      if (mins <= currentMinutes) continue;
    }
    const timeStr = toTimeStr(hour, minute);
    const availability = await checkAvailabilityForOrg(
      organizationId,
      dateStr,
      timeStr,
      60
    );
    if (availability.available) {
      available.push(timeStr);
    }
  }
  return available;
}

function isDateAllowedForReservation(
  dateStr: string,
  schedule?: { workingDays?: number[]; blockedDates?: string[] }
): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(year, month - 1, day, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return false;
  const blocked = new Set((schedule?.blockedDates ?? []).map((d) => d.trim()));
  if (blocked.has(dateStr)) return false;
  const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
  return workingDays.includes(dt.getDay());
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

/** Mensagem para descoberta da necessidade: se o cliente já disse que quer agendar, pede o motivo/problema em vez de "qual a dúvida". */
function buildNeedDiscoveryPrompt(intentProbeText: string): string {
  if (looksLikeReservationIntent(intentProbeText)) {
    return "Antes de agendar um horário, preciso entender melhor o seu problema ou serviço. Me diga o que precisa ser feito no veículo para que eu possa te direcionar da melhor forma possível.";
  }
  return "Qual é a sua dúvida?";
}

function looksLikeRestaurantReservationIntent(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    /\b(mesa|reserva de mesa|reservar mesa|quero uma mesa|mesa para)\b/.test(t) ||
    (/\b(reservar|reserva)\b/.test(t) && /\b(mesa|jantar|almoco)\b/.test(t))
  );
}

function extractPeopleCount(text: string): number | null {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const pessoas = t.match(/(\d{1,2})\s*pessoas?/);
  if (pessoas) {
    const n = Number(pessoas[1]);
    if (n >= 1 && n <= 20) return n;
  }
  const para = t.match(/para\s+(\d{1,2})/);
  if (para) {
    const n = Number(para[1]);
    if (n >= 1 && n <= 20) return n;
  }
  const onlyNum = t.match(/^(\d{1,2})$/);
  if (onlyNum) {
    const n = Number(onlyNum[1]);
    if (n >= 1 && n <= 20) return n;
  }
  const wordMap: Record<string, number> = {
    uma: 1,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
  };
  const word = t.replace(/\s*pessoas?/g, "").trim();
  if (wordMap[word] !== undefined) return wordMap[word];
  return null;
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
  if (hasSpecificNeed) {
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

/** Extrai código de motor (ex: ea111) para busca em produtos */
function extractEngineCodeFromText(text: string): string | null {
  const normalized = normalizeForSearch(text);
  const match = normalized.match(/\b(ea\d{3}|tsi|tfsi|gdi|mpi|fsi)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function looksLikeScheduleAgreement(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    /\b(vamos|vamos sim|quero|sim|pode|pode ser|confirmo)\s+(agendar|agendamento|reservar|reserva)\b/.test(t) ||
    /\b(agendar|agendamento|reservar)\s+(sim|por favor|pode ser)\b/.test(t) ||
    /^(vamos|sim|quero|pode)\s+(agendar|agendamento|reservar|reserva)/.test(t)
  );
}

function isOilExchangeIntent(text: string): boolean {
  const t = normalizeForSearch(text);
  return /\b(oleo|troca de oleo|troca oleo|lubrificacao)\b/.test(t);
}

function shouldAskOilQualification(text: string): boolean {
  return isOilExchangeIntent(text) && !extractOilSpec(text);
}

function isRevisionServiceIntent(text: string): boolean {
  const t = normalizeForSearch(text);
  return /\b(revisao|checkup|check up)\b/.test(t);
}

function looksLikeUnknownOilMessage(text: string): boolean {
  const t = normalizeForSearch(text);
  return (
    /\b(nao sei|não sei|nao lembro|não lembro|nao faco ideia|não faco ideia)\b/.test(t) &&
    /\b(oleo|lubrificante|viscosidade)\b/.test(t)
  );
}

function isGenericBudgetRequest(text: string): boolean {
  const t = normalizeForSearch(text);
  const asksBudget = /\b(orcamento|preco|valor|quanto)\b/.test(t);
  const hasSpecificNeed =
    /\b(oleo|filtro|troca|trocar|revisao|freio|alinhamento|balanceamento|suspensao|embreagem|bateria|pneu|motor|correia|correia dentada|amortecedor|pastilha|disco|vela|inje[cç][aã]o)\b/.test(
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
  const [allProducts, allServices, allCategories] = await Promise.all([
    db
      .select()
      .from(products)
      .where(eq(products.organizationId, organizationId)),
    db
      .select()
      .from(services)
      .where(eq(services.organizationId, organizationId)),
    db
      .select()
      .from(productCategories)
      .where(eq(productCategories.organizationId, organizationId)),
  ]);
  const categoryByKey = new Map(
    allCategories.map((c) => [c.key, { name: c.name, aliases: c.aliases ?? "" }])
  );

  const oilSpec = extractOilSpec(messageContent);

  const productMatches = allProducts
    .filter((p) => p.isActive)
    .map((p) => ({
      item: p,
      score: scoreMatch(
        `${p.name} ${p.model ?? ""} ${p.description ?? ""} ${p.category ?? ""} ${
          categoryByKey.get(p.category ?? "")?.name ?? ""
        } ${categoryByKey.get(p.category ?? "")?.aliases ?? ""}`,
        tokens
      ),
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
  const firstProduct = productMatches[0];
  const firstService = serviceMatches[0];

  if (firstProduct && firstService) {
    const productLabel = firstProduct.model?.trim()
      ? `${firstProduct.name} ${firstProduct.model}`
      : firstProduct.name;
    const productPrice = formatCurrencyFromCents(firstProduct.priceCents);
    const servicePrice = formatCurrencyFromCents(firstService.priceCents);
    lines.push(
      `Temos ${productLabel} por ${productPrice}, e a ${firstService.name.toLowerCase()} fica em ${servicePrice} (${firstService.durationMinutes} min).`
    );
  } else if (firstProduct) {
    const productLabel = firstProduct.model?.trim()
      ? `${firstProduct.name} ${firstProduct.model}`
      : firstProduct.name;
    const productPrice = formatCurrencyFromCents(firstProduct.priceCents);
    lines.push(`Temos ${productLabel} disponível por ${productPrice}.`);
  } else if (firstService) {
    const servicePrice = formatCurrencyFromCents(firstService.priceCents);
    lines.push(
      `A ${firstService.name.toLowerCase()} está saindo por ${servicePrice} e leva cerca de ${firstService.durationMinutes} min.`
    );
  }

  lines.push("Se você quiser, já consulto a disponibilidade e deixo um horário reservado. Qual dia e horário prefere?");

  return {
    reply: lines.join("\n"),
    productMatches: productMatches.length,
    serviceMatches: serviceMatches.length,
    selectedProductName: productMatches[0]?.name ?? null,
    selectedServiceName: serviceMatches[0]?.name ?? null,
  };
}

type OilAvailabilityResult =
  | { status: "available"; reply: string; productMatches: number }
  | { status: "out_of_stock"; productName: string; priceStr: string }
  | null;

/** Busca produtos de óleo. Retorna disponível, indisponível (sem estoque) ou null (não encontrado). */
async function buildOilAvailabilityReply(
  organizationId: string,
  oilSpec: string | null,
  engineCode: string | null,
  fallbackSearchText?: string
): Promise<OilAvailabilityResult> {
  const [allProducts] = await Promise.all([
    db.select().from(products).where(eq(products.organizationId, organizationId)),
  ]);
  const oilNorm = oilSpec ? normalizeForSearch(oilSpec) : "";
  const engineNorm = engineCode ? normalizeForSearch(engineCode) : "";
  const fallbackTokens = fallbackSearchText ? extractSearchTokens(fallbackSearchText) : [];
  const matchesOil = (p: { name: string; model: string | null; description: string | null }) => {
    const h = normalizeForSearch(`${p.name} ${p.model ?? ""} ${p.description ?? ""}`);
    if (!h.includes("oleo") && !h.includes("óleo")) return false;
    if (oilNorm && h.includes(oilNorm)) return true;
    if (engineNorm && h.includes(engineNorm)) return true;
    if (fallbackTokens.length > 0 && fallbackTokens.some((t) => t.length >= 3 && h.includes(t))) return true;
    if (!oilNorm && !engineNorm && fallbackTokens.length === 0) return true;
    return false;
  };
  const oilProductsInStock = allProducts
    .filter((p) => p.isActive && p.isInStock && matchesOil(p))
    .slice(0, 1);
  const oilProductsOutOfStock = allProducts
    .filter((p) => p.isActive && !p.isInStock && matchesOil(p))
    .slice(0, 1);
  const firstInStock = oilProductsInStock[0];
  const firstOutOfStock = oilProductsOutOfStock[0];
  if (firstInStock) {
    const priceStr = formatCurrencyFromCents(firstInStock.priceCents);
    const reply = `Temos disponível para troca! O valor do óleo é de *${priceStr}*. Vamos agendar sua visita?`;
    return { status: "available", reply, productMatches: 1 };
  }
  if (firstOutOfStock) {
    const priceStr = formatCurrencyFromCents(firstOutOfStock.priceCents);
    return { status: "out_of_stock", productName: firstOutOfStock.name, priceStr };
  }
  return null;
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

  // Coleta sequencial: sempre um dado por vez.
  if (missing.includes("modelo")) {
    return "Perfeito. Para eu consultar a disponibilidade e te ajudar com a reserva, me informe o *modelo* do veículo.";
  }
  if (missing.includes("ano")) {
    return "Ótimo. Agora me informe o *ano* do veículo.";
  }
  return "Perfeito. Agora me informe a *quilometragem (km)* do veículo. Se não souber, tudo bem.";
}

function buildMissingVehicleRequiredReply(missing: ("modelo" | "ano" | "km")[]): string {
  const requiredMissing = missing.filter((m) => m !== "km");
  if (requiredMissing.length === 0) {
    return "Perfeito. Se souber, me passe também a *quilometragem (km)* para deixar o orçamento mais preciso.";
  }
  if (requiredMissing.length === 2) {
    return "Para seguir certinho, me informe o *modelo* e o *ano* do veículo. Se souber, o *km* também ajuda a deixar o orçamento mais preciso.";
  }
  if (requiredMissing[0] === "modelo") {
    return "Perfeito, já anotei o ano. Agora me informe o *modelo* do veículo. Se souber, pode me passar o *km* também.";
  }
  return "Perfeito, já anotei o modelo. Agora me informe o *ano* do veículo. Se souber, pode me passar o *km* também.";
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
  if (INVALID_NAME_TERMS.has(normalized)) {
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
      !INVALID_NAME_TERMS.has(normalizedLeading) &&
      !((options?.blockedValues ?? []).map(normalizePlainText).includes(normalizedLeading))
    ) {
      return leadingSegment.replace(/\s+/g, " ").trim();
    }
  }

  if (/^[a-zà-ú' ]{2,40}$/i.test(trimmed) && trimmed.split(/\s+/).length <= 3) {
    const normalized = normalizePlainText(trimmed);
    const wordsCount = normalized.split(" ").filter(Boolean).length;
    if (wordsCount === 1 && !options?.allowSingleWord) return null;
    if (INVALID_NAME_TERMS.has(normalized)) {
      return null;
    }
    if ((options?.blockedValues ?? []).map(normalizePlainText).includes(normalized)) {
      return null;
    }
    return trimmed.replace(/\s+/g, " ").trim();
  }

  return null;
}

function looksLikeInvalidNameAnswer(text: string): boolean {
  const normalized = normalizePlainText(text);
  if (!normalized) return true;
  if (INVALID_NAME_TERMS.has(normalized)) return true;
  if (/\d/.test(normalized)) return true;
  return false;
}

function buildMissingReservationProfileReply(
  missingName: boolean,
  missingVehicle: ("modelo" | "ano" | "km")[]
): string {
  // Coleta sequencial para não sobrecarregar o cliente com múltiplos campos.
  if (missingName) {
    return "Antes de confirmar, qual é o seu *nome*?";
  }
  if (missingVehicle.includes("modelo")) {
    return "Perfeito. Agora me informe o *modelo do veículo*.";
  }
  if (missingVehicle.includes("ano")) {
    return "Ótimo. Agora me informe o *ano do veículo*.";
  }
  if (missingVehicle.includes("km")) {
    return "Perfeito. Agora me informe a *quilometragem (km)* do veículo. Se não souber, pode me avisar.";
  }
  return "Perfeito. Pode me confirmar a reserva?";
}

type SlotConfidence = "none" | "low" | "medium" | "high";
type ReservationCollectionStage =
  | "collect_profile"
  | "collect_datetime"
  | "confirm_reservation"
  | "completed";
type IntakeStage =
  | "awaiting_name"
  | "awaiting_vehicle"
  | "awaiting_need"
  | "awaiting_issue"
  | "awaiting_reservation_profile";

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
  if (repeatCount === 1) return `${base}\n\nPode enviar só esse dado, por favor.`;
  return `${base}\n\nMe manda apenas esse dado para eu seguir certinho.`;
}

function buildVehicleFollowUpForOilQuote(slots: VehicleSlots | undefined): string {
  const vehicleSlots = slots ?? {};
  const missingRequired: ("modelo" | "ano")[] = [];
  if (!vehicleSlots.modelo) missingRequired.push("modelo");
  if (!vehicleSlots.ano) missingRequired.push("ano");

  if (missingRequired.length > 0) {
    const requiredLine =
      missingRequired.length === 2
        ? "Antes de finalizar, preciso confirmar o *modelo* e o *ano* do veículo."
        : `Antes de finalizar, preciso confirmar o *${missingRequired[0]}* do veículo.`;
    return `${requiredLine}\nSe conseguir, me passe também a *quilometragem (km)* para deixar o orçamento mais preciso. Se não souber, é só me avisar que eu continuo o atendimento.`;
  }

  if (!vehicleSlots.km) {
    return "Consegue me passar a *quilometragem (km)* do veículo? Isso ajuda a deixar o orçamento mais preciso. Se não souber, é só me avisar que eu continuo o atendimento.";
  }

  const vehicleLabel = [
    vehicleSlots.modelo ? vehicleSlots.modelo : null,
    vehicleSlots.ano ? String(vehicleSlots.ano) : null,
    vehicleSlots.km ? `${vehicleSlots.km} km` : null,
  ]
    .filter(Boolean)
    .join(" - ");

  return `Antes de seguir, confirmando: estou com o veículo *${vehicleLabel}*.\nSe mudou, me informe o novo *modelo, ano e km* para eu atualizar.`;
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
    stage === "awaiting_name" ||
    stage === "awaiting_vehicle" ||
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
  const [row] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const baseMetadata =
    (row?.conversationStateMetadata as Record<string, unknown> | undefined) ?? currentMetadata;
  const nextMetadata = { ...baseMetadata };
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
  const [row] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const baseMetadata =
    (row?.conversationStateMetadata as Record<string, unknown> | undefined) ?? currentMetadata;
  const nextMetadata = { ...baseMetadata };
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

type VehicleConfirmationState = {
  pending: boolean;
  confirmed: boolean;
  vehicleSignature: string;
};

type OilFlowState = {
  awaitingUnknownOilConfirmation?: boolean;
  /** Perguntou "sabe o óleo? sim/não" e aguarda resposta */
  awaitingOilYesNo?: boolean;
  /** Perguntou "consegue me falar o óleo?" e aguarda resposta */
  awaitingOilSpec?: boolean;
  /** Tem óleo encontrado, pediu dados do veículo - ao completar, oferece "vamos agendar?" */
  awaitingOilVehicle?: boolean;
  /** Ofereceu preço e perguntou "vamos agendar?" - aguarda confirmação */
  awaitingOilScheduleConfirmation?: boolean;
};

type WorkshopState = {
  carInShop: boolean;
  awaitingVehicleDetails: boolean;
};

type ProfileUpdateFlowState = {
  awaitingConfirmation: boolean;
};

type ResumeChoiceFlowState = {
  awaitingChoice: boolean;
};

function getVehicleConfirmationState(
  metadata: Record<string, unknown>
): VehicleConfirmationState {
  const flow = (metadata.vehicleConfirmation as Record<string, unknown> | undefined) ?? {};
  return {
    pending: flow.pending === true,
    confirmed: flow.confirmed === true,
    vehicleSignature:
      typeof flow.vehicleSignature === "string" ? flow.vehicleSignature : "",
  };
}

async function persistVehicleConfirmationState(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  nextState: VehicleConfirmationState | null
): Promise<void> {
  const nextMetadata = { ...currentMetadata };
  if (nextState) {
    nextMetadata.vehicleConfirmation = {
      ...nextState,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMetadata.vehicleConfirmation;
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

function getOilFlowState(metadata: Record<string, unknown>): OilFlowState {
  const flow = (metadata.oilFlow as Record<string, unknown> | undefined) ?? {};
  return {
    awaitingUnknownOilConfirmation: flow.awaitingUnknownOilConfirmation === true,
    awaitingOilYesNo: flow.awaitingOilYesNo === true,
    awaitingOilSpec: flow.awaitingOilSpec === true,
    awaitingOilVehicle: flow.awaitingOilVehicle === true,
    awaitingOilScheduleConfirmation: flow.awaitingOilScheduleConfirmation === true,
  };
}

async function persistOilFlowState(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  nextState: OilFlowState | null
): Promise<void> {
  const nextMetadata = { ...currentMetadata };
  if (nextState) {
    nextMetadata.oilFlow = {
      ...nextState,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMetadata.oilFlow;
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

function getWorkshopState(metadata: Record<string, unknown>): WorkshopState {
  const flow = (metadata.workshopFlow as Record<string, unknown> | undefined) ?? {};
  return {
    carInShop: flow.carInShop === true,
    awaitingVehicleDetails: flow.awaitingVehicleDetails === true,
  };
}

async function persistWorkshopState(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  nextState: WorkshopState | null
): Promise<void> {
  const [row] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const baseMetadata =
    (row?.conversationStateMetadata as Record<string, unknown> | undefined) ?? currentMetadata;
  const nextMetadata = { ...baseMetadata };
  if (nextState) {
    nextMetadata.workshopFlow = {
      ...nextState,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMetadata.workshopFlow;
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

function getProfileUpdateFlowState(
  metadata: Record<string, unknown>
): ProfileUpdateFlowState {
  const flow = (metadata.profileUpdateFlow as Record<string, unknown> | undefined) ?? {};
  return {
    awaitingConfirmation: flow.awaitingConfirmation === true,
  };
}

async function persistProfileUpdateFlowState(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  nextState: ProfileUpdateFlowState | null
): Promise<void> {
  const [row] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const baseMetadata =
    (row?.conversationStateMetadata as Record<string, unknown> | undefined) ?? currentMetadata;
  const nextMetadata = { ...baseMetadata };
  if (nextState) {
    nextMetadata.profileUpdateFlow = {
      ...nextState,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMetadata.profileUpdateFlow;
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

function getResumeChoiceFlowState(
  metadata: Record<string, unknown>
): ResumeChoiceFlowState {
  const flow = (metadata.resumeChoiceFlow as Record<string, unknown> | undefined) ?? {};
  return {
    awaitingChoice: flow.awaitingChoice === true,
  };
}

async function persistResumeChoiceFlowState(
  conversationId: string,
  currentMetadata: Record<string, unknown>,
  nextState: ResumeChoiceFlowState | null
): Promise<void> {
  const [row] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const baseMetadata =
    (row?.conversationStateMetadata as Record<string, unknown> | undefined) ?? currentMetadata;
  const nextMetadata = { ...baseMetadata };
  if (nextState) {
    nextMetadata.resumeChoiceFlow = {
      ...nextState,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete nextMetadata.resumeChoiceFlow;
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

async function clearConversationFlowState(
  conversationId: string,
  currentMetadata: Record<string, unknown>
): Promise<void> {
  const [row] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const baseMetadata =
    (row?.conversationStateMetadata as Record<string, unknown> | undefined) ?? currentMetadata;
  const nextMetadata = { ...baseMetadata };
  delete nextMetadata.intakeFlow;
  delete nextMetadata.reservationFlow;
  delete nextMetadata.reservationPeriodFlow;
  delete nextMetadata.pendingReservation;
  delete nextMetadata.reservationContext;
  delete nextMetadata.profileUpdateFlow;
  delete nextMetadata.oilFlow;
  delete nextMetadata.vehicleConfirmation;
  delete nextMetadata.workshopFlow;
  delete nextMetadata.restaurantReservationFlow;
  delete nextMetadata.resumeChoiceFlow;

  await db
    .update(conversations)
    .set({
      conversationState: CONVERSATION_STATES.INIT,
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
  const reservationScheduleSettings =
    (settings.reservationSchedule as Record<string, unknown> | undefined) ?? {};
  const businessHoursSettings =
    (settings.businessHours as Record<string, unknown> | undefined) ?? {};
  const businessProfileSettings =
    (settings.businessProfile as Record<string, unknown> | undefined) ?? {};
  const botConfigSettings =
    (settings.botConfig as Record<string, unknown> | undefined) ?? {};
  const vehicleServicePolicySettings =
    (settings.vehicleServicePolicy as Record<string, unknown> | undefined) ?? {};
  const offeredServicesSettings =
    (settings.offeredServicesConfig as Record<string, unknown> | undefined) ?? {};
  const configuredSegment =
    (botConfigSettings.segment as "mecanica" | "restaurante" | "geral" | undefined) ??
    undefined;
  const isMecanicaSegment = configuredSegment === "mecanica";
  const isRestauranteSegment = configuredSegment === "restaurante";
  const reservationSchedule = {
    start:
      (reservationScheduleSettings.start as string | undefined) ||
      (businessHoursSettings.start as string | undefined) ||
      "09:00",
    end:
      (reservationScheduleSettings.end as string | undefined) ||
      (businessHoursSettings.end as string | undefined) ||
      "17:00",
    timezone:
      (reservationScheduleSettings.timezone as string | undefined) ||
      (businessHoursSettings.timezone as string | undefined) ||
      "America/Sao_Paulo",
    workingDays: Array.isArray(reservationScheduleSettings.workingDays)
      ? (reservationScheduleSettings.workingDays as number[])
      : [1, 2, 3, 4, 5],
    blockedDates: Array.isArray(reservationScheduleSettings.blockedDates)
      ? (reservationScheduleSettings.blockedDates as string[])
      : [],
  };
  const usesVehicleSlots =
    configuredSegment
      ? isMecanicaSegment
      : /modelo|ano|quilometragem|veículo/i.test(systemPrompt) &&
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
          conversationStateMetadata: {
            ...metadata,
            vehicleSlots,
            vehicleSlotsUpdatedAt: new Date().toISOString(),
          },
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
    knownOilSpec: memories.vehicle_oil_spec ?? null,
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
    reservationSchedule,
    businessProfile: {
      botName: (businessProfileSettings.botName as string | undefined) ?? null,
      instagram:
        (businessProfileSettings.instagram as string | undefined) ?? null,
      address: (businessProfileSettings.address as string | undefined) ?? null,
      mapsLink: (businessProfileSettings.mapsLink as string | undefined) ?? null,
      about: (businessProfileSettings.about as string | undefined) ?? null,
    },
    botConfig: {
      segment: configuredSegment ?? (isRestauranteSegment ? "restaurante" : "mecanica"),
      tone:
        (botConfigSettings.tone as "formal" | "neutro" | "casual" | undefined) ??
        "neutro",
      language: (botConfigSettings.language as string | undefined) ?? "pt-BR",
    },
    offeredServices: Array.isArray(offeredServicesSettings.selectedServices)
      ? (offeredServicesSettings.selectedServices as string[])
      : [],
    vehicleServicePolicy: {
      minAllowedYear:
        typeof vehicleServicePolicySettings.minAllowedYear === "number"
          ? vehicleServicePolicySettings.minAllowedYear
          : null,
      blockedModels: Array.isArray(vehicleServicePolicySettings.blockedModels)
        ? (vehicleServicePolicySettings.blockedModels as string[])
        : [],
      blockedModelYears: Array.isArray(vehicleServicePolicySettings.blockedModelYears)
        ? (vehicleServicePolicySettings.blockedModelYears as Array<{
            model: string;
            year?: number | null;
          }>)
        : [],
    },
    customerContext: params.customerContext ?? null,
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
  // Usar chave da aba Configurações (Agente de IA) primeiro; fallback para variável de ambiente
  const orgApiKey = (aiAgent?.apiKey as string)?.trim();
  const apiKey = orgApiKey || process.env.GEMINI_API_KEY || undefined;

  try {
    const trainingExamples = await findRelevantExamples(
      ctx.organizationId,
      ctx.messageContent,
      3
    );
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
        businessAbout: ctx.businessProfile?.about ?? undefined,
        customerContext: ctx.customerContext ?? undefined,
        trainingExamples: trainingExamples.length > 0 ? trainingExamples : undefined,
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

    const exampleIds = trainingExamples.map((ex) => ex.id);
    if (exampleIds.length > 0) {
      await incrementUsageCount(exampleIds);
      await setLastUsedExampleIds(ctx.conversationId, exampleIds);
    }
    await clearLastUsedFaqId(ctx.conversationId);

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

  const sentReplies = new Set<string>();
  const originalSendMessage = options.sendMessage;
  const sendMessage = async (convId: string, text: string) => {
    const normalized = text.trim();
    if (!normalized || sentReplies.has(normalized)) return;
    sentReplies.add(normalized);
    await originalSendMessage(convId, text);
  };

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

  const [convMetaRow] = await db
    .select({ conversationStateMetadata: conversations.conversationStateMetadata })
    .from(conversations)
    .where(eq(conversations.id, ctx.conversationId))
    .limit(1);
  const conversationMetadata =
    (convMetaRow?.conversationStateMetadata as Record<string, unknown>) ?? {};
  const intakeStage = getIntakeStage(conversationMetadata);
  const reservationContext = getReservationContext(conversationMetadata);
  const vehicleConfirmation = getVehicleConfirmationState(conversationMetadata);
  const oilFlowState = getOilFlowState(conversationMetadata);
  const workshopState = getWorkshopState(conversationMetadata);
  const profileUpdateFlow = getProfileUpdateFlowState(conversationMetadata);
  const resumeChoiceFlow = getResumeChoiceFlowState(conversationMetadata);
  const reservationFlow = (conversationMetadata.reservationFlow as Record<string, unknown> | undefined) ?? {};
  const isCollectProfileStage = reservationFlow.collectionStage === "collect_profile";
  const isImplicitAwaitingName =
    intakeStage !== "awaiting_name" &&
    (await wasRecentNamePrompt(ctx.conversationId));
  const isAwaitingNameStage =
    intakeStage === "awaiting_name" || isImplicitAwaitingName;
  let contactName = ctx.contactName ?? null;
  const missingVehicleProfileAtEntry = ctx.usesVehicleSlots
    ? getMissingSlots(ctx.vehicleSlots ?? {})
    : [];
  const missingNameProfileAtEntry = !contactName;
  const hasModelAndYearProfile = !!(ctx.vehicleSlots?.modelo && ctx.vehicleSlots?.ano);
  const knownVehicleLabel = [ctx.vehicleSlots?.modelo, ctx.vehicleSlots?.ano]
    .filter(Boolean)
    .join(" ");
  const restaurantFlow = getRestaurantReservationFlow(conversationMetadata);
  const hasRestaurantActiveFlow =
    ctx.botConfig?.segment === "restaurante" &&
    restaurantFlow?.collectionStage &&
    restaurantFlow.collectionStage !== "completed";
  const hasActiveFlow =
    hasActiveConversationFlowState(ctx.conversationState) ||
    !!intakeStage ||
    !!ctx.pendingReservation ||
    vehicleConfirmation.pending ||
    oilFlowState.awaitingUnknownOilConfirmation ||
    oilFlowState.awaitingOilYesNo ||
    oilFlowState.awaitingOilSpec ||
    oilFlowState.awaitingOilVehicle ||
    oilFlowState.awaitingOilScheduleConfirmation ||
    workshopState.awaitingVehicleDetails ||
    reservationFlow.collectionStage === "collect_profile" ||
    reservationFlow.collectionStage === "collect_datetime" ||
    reservationFlow.collectionStage === "confirm_reservation" ||
    hasRestaurantActiveFlow;

  const buildActiveFlowContinuationReply = (intentProbeForNeed?: string): string | null => {
    if (intakeStage === "awaiting_name") {
      return "Para seguir, me diga seu *nome*, por favor.";
    }
    if (intakeStage === "awaiting_vehicle") {
      return "Para seguir certinho, me informe o *modelo* e o *ano* do veículo. Se souber, o *km* também ajuda a deixar o orçamento mais preciso.";
    }
    if (intakeStage === "awaiting_need") {
      const needPrompt = intentProbeForNeed
        ? buildNeedDiscoveryPrompt(intentProbeForNeed)
        : "Qual é a sua dúvida principal?";
      return `Perfeito. ${needPrompt}`;
    }
    if (intakeStage === "awaiting_issue") {
      return "Me descreva o que está acontecendo com o veículo para eu direcionar o próximo passo.";
    }
    if (
      intakeStage === "awaiting_reservation_profile" ||
      reservationFlow.collectionStage === "collect_profile" ||
      workshopState.awaitingVehicleDetails
    ) {
      return buildMissingReservationProfileReply(
        missingNameProfileAtEntry,
        missingVehicleProfileAtEntry
      );
    }
    if (oilFlowState.awaitingUnknownOilConfirmation) {
      return "Você sabe o tipo do óleo? (ex.: *5W30*). Se não souber, me avise que eu encaminho para o mecânico técnico.";
    }
    if (oilFlowState.awaitingOilYesNo) {
      return "Você sabe o óleo utilizado no motor? Responda com *sim* ou *não*.";
    }
    if (oilFlowState.awaitingOilSpec) {
      return "Consegue me falar o óleo?";
    }
    if (oilFlowState.awaitingOilVehicle) {
      return "Para seguir com o agendamento, me informe o *modelo* e o *ano* do veículo.";
    }
    if (oilFlowState.awaitingOilScheduleConfirmation) {
      return "Vamos agendar sua visita?";
    }
    if (vehicleConfirmation.pending && knownVehicleLabel) {
      return `Só confirmando antes de seguir: o veículo é *${knownVehicleLabel}*?`;
    }
    if (ctx.pendingReservation) {
      return "Posso seguir com a reserva. Confirma para mim o *dia* e *horário* desejados?";
    }
    if (restaurantFlow?.collectionStage === "collect_name") {
      return "Para seguir, me diga seu *nome*, por favor.";
    }
    if (restaurantFlow?.collectionStage === "collect_date") {
      return "Para qual data você gostaria de reservar? (ex: amanhã ou 15/03)";
    }
    if (restaurantFlow?.collectionStage === "collect_datetime") {
      return "Qual horário você prefere? Atendemos conforme nossa agenda.";
    }
    if (restaurantFlow?.collectionStage === "collect_people") {
      return "Para quantas pessoas será a reserva?";
    }
    if (restaurantFlow?.collectionStage === "confirm_reservation") {
      const people = restaurantFlow.peopleCount ?? 0;
      return `Confirmar reserva para *${people}* pessoa(s)? Responda *sim* para confirmar.`;
    }
    return null;
  };

  if (resumeChoiceFlow.awaitingChoice) {
    if (looksLikeRestartFlowChoice(ctx.messageContent)) {
      await clearConversationFlowState(ctx.conversationId, conversationMetadata);
      const restartReply = contactName?.trim()
        ? `Perfeito, *${contactName.trim()}*. Iniciamos um novo atendimento. Como posso te ajudar hoje?`
        : `Perfeito, iniciamos um novo atendimento. ${getRandomNameQuestion()}`;
      await sendMessage(ctx.conversationId, restartReply);
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente escolheu iniciar novo atendimento",
        silence: false,
      };
    }

    if (looksLikeContinueFlowChoice(ctx.messageContent) || isSimpleAffirmative(ctx.messageContent)) {
      await persistResumeChoiceFlowState(ctx.conversationId, conversationMetadata, null);
      const continuationReply = buildActiveFlowContinuationReply() ??
        "Perfeito, vamos continuar de onde paramos. Como posso ajudar?";
      await sendMessage(ctx.conversationId, continuationReply);
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente escolheu continuar atendimento anterior",
        silence: false,
      };
    }

    await sendMessage(
      ctx.conversationId,
      "Quer *continuar* o atendimento anterior ou iniciar um *novo atendimento*?"
    );
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Aguardando escolha de retomada",
      silence: false,
    };
  }

  if (hasActiveFlow && looksLikeGreeting(ctx.messageContent)) {
    const shouldOfferResumeChoice = await shouldOfferFlowResumeChoice(ctx.conversationId);
    if (shouldOfferResumeChoice) {
      await persistResumeChoiceFlowState(ctx.conversationId, conversationMetadata, {
        awaitingChoice: true,
      });
      await sendMessage(
        ctx.conversationId,
        "Bem-vindo de volta! Quer *continuar* o atendimento anterior ou iniciar um *novo atendimento*?"
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Saudação após inatividade; solicitando escolha de retomada",
        silence: false,
      };
    }
  }

  const intentProbeText = await buildIntentProbeText(
    ctx.conversationId,
    ctx.messageContent
  );

  const hasActiveOilFlow =
    oilFlowState.awaitingUnknownOilConfirmation ||
    oilFlowState.awaitingOilYesNo ||
    oilFlowState.awaitingOilSpec ||
    oilFlowState.awaitingOilVehicle ||
    oilFlowState.awaitingOilScheduleConfirmation;
  const hasActiveReservationFlow =
    reservationFlow.collectionStage === "collect_profile" ||
    reservationFlow.collectionStage === "collect_datetime" ||
    reservationFlow.collectionStage === "confirm_reservation";

  // Fluxo de troca de óleo: pergunta óleo ANTES de nome/veículo. Prioriza fluxo específico quando ativo.
  if (
    ctx.usesVehicleSlots &&
    (isOilExchangeIntent(intentProbeText) || hasActiveOilFlow)
  ) {
    const detectedOilSpec = extractOilSpec(ctx.messageContent);
    const engineCode = extractEngineCodeFromText(ctx.messageContent);

    if (oilFlowState.awaitingOilVehicle) {
      const mergedVehicle = mergeVehicleSlots(
        ctx.vehicleSlots ?? {},
        extractVehicleSlotsFromText(ctx.messageContent)
      );
      const missingAfterMerge = getMissingSlots(mergedVehicle);
      const hasModelAndYearNow = !!(mergedVehicle.modelo && mergedVehicle.ano);
      if (hasModelAndYearNow && missingAfterMerge.length <= 1) {
        if (JSON.stringify(mergedVehicle) !== JSON.stringify(ctx.vehicleSlots ?? {})) {
          await db
            .update(conversations)
            .set({
              conversationStateMetadata: {
                ...conversationMetadata,
                vehicleSlots: mergedVehicle,
                vehicleSlotsUpdatedAt: new Date().toISOString(),
              },
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, ctx.conversationId));
          if (mergedVehicle.modelo) await saveContactMemory(ctx.contactId, "vehicle_model", mergedVehicle.modelo);
          if (mergedVehicle.ano) await saveContactMemory(ctx.contactId, "vehicle_year", String(mergedVehicle.ano));
          if (mergedVehicle.km) await saveContactMemory(ctx.contactId, "vehicle_km", String(mergedVehicle.km));
        }
        const vehiclePolicyDecision = evaluateVehicleServicePolicy(
          ctx.vehicleServicePolicy,
          mergedVehicle
        );
        if (vehiclePolicyDecision.blocked && vehiclePolicyDecision.reason) {
          await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
          await sendMessage(
            ctx.conversationId,
            `${vehiclePolicyDecision.reason}\n\nPosso te encaminhar para um mecânico técnico verificar outras opções.`
          );
          return { didReply: true, decision: "tool_then_ai", reason: "Veículo não atendido pela política", silence: false };
        }
        const oilReplyNow = await buildOilAvailabilityReply(
          ctx.organizationId,
          ctx.knownOilSpec ?? null,
          extractEngineCodeFromText(ctx.messageContent),
          ctx.messageContent
        );
        if (oilReplyNow?.status === "available") {
          await persistOilFlowState(ctx.conversationId, conversationMetadata, {
            awaitingOilVehicle: false,
            awaitingOilScheduleConfirmation: true,
          });
          await sendMessage(ctx.conversationId, oilReplyNow.reply);
          return { didReply: true, decision: "tool_then_ai", reason: "Dados do veículo completos; oferecendo agendamento", silence: false };
        }
        if (oilReplyNow?.status === "out_of_stock") {
          await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
          await sendMessage(
            ctx.conversationId,
            `No momento não temos o óleo *${oilReplyNow.productName}* disponível em estoque. Posso te encaminhar para um mecânico técnico verificar a disponibilidade e agendar?`
          );
          return { didReply: true, decision: "tool_then_ai", reason: "Óleo sem estoque; oferecendo encaminhamento", silence: false };
        }
      }
      const stillMissing = getMissingSlots(mergeVehicleSlots(ctx.vehicleSlots ?? {}, extractVehicleSlotsFromText(ctx.messageContent)));
      if (stillMissing.length > 0) {
        await sendMessage(
          ctx.conversationId,
          `Para seguir com o agendamento, ${buildMissingVehicleRequiredReply(stillMissing)}`
        );
        return { didReply: true, decision: "tool_then_ai", reason: "Aguardando dados do veículo para óleo", silence: false };
      }
    }

    if (oilFlowState.awaitingOilScheduleConfirmation && looksLikeScheduleAgreement(ctx.messageContent)) {
      await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Troca de Óleo",
        productName: reservationContext.productName,
      });
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_reservation_profile");
      const missingForSchedule = getMissingSlots(ctx.vehicleSlots ?? {});
      const vehiclePart =
        missingForSchedule.length === 0
          ? ""
          : ` e os dados do veículo (${missingForSchedule.map((s) => `*${s}*`).join(", ").replace(/, ([^,]*)$/, " e $1")})`;
      await sendMessage(
        ctx.conversationId,
        `Perfeito! Para agendar, me informe seu *nome*${vehiclePart}.`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente confirmou agendamento de troca de óleo",
        silence: false,
      };
    }

    if (oilFlowState.awaitingOilYesNo) {
      const oilFromMessage = extractOilSpec(ctx.messageContent);
      if (oilFromMessage) {
        await saveContactMemory(ctx.contactId, "vehicle_oil_spec", oilFromMessage);
        await persistOilFlowState(ctx.conversationId, conversationMetadata, {
          awaitingOilYesNo: false,
          awaitingOilSpec: false,
        });
        const oilToSearch = oilFromMessage;
        const engineCode = extractEngineCodeFromText(ctx.messageContent);
        const oilReply = await buildOilAvailabilityReply(
          ctx.organizationId,
          oilToSearch,
          engineCode,
          ctx.messageContent
        );
        if (oilReply?.status === "out_of_stock") {
          await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
          await sendMessage(
            ctx.conversationId,
            `No momento não temos o óleo *${oilReply.productName}* disponível em estoque. Posso te encaminhar para um mecânico técnico verificar a disponibilidade e agendar?`
          );
          return { didReply: true, decision: "tool_then_ai", reason: "Óleo sem estoque; oferecendo encaminhamento", silence: false };
        }
        if (oilReply?.status === "available") {
          const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
          const hasModelAndYear = !!(ctx.vehicleSlots?.modelo && ctx.vehicleSlots?.ano);
          if (missingVehicle.length === 0 && hasModelAndYear) {
            const vehiclePolicyDecision = evaluateVehicleServicePolicy(
              ctx.vehicleServicePolicy,
              ctx.vehicleSlots ?? {}
            );
            if (vehiclePolicyDecision.blocked && vehiclePolicyDecision.reason) {
              await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
              await sendMessage(
                ctx.conversationId,
                `${vehiclePolicyDecision.reason}\n\nPosso te encaminhar para um mecânico técnico verificar outras opções.`
              );
              return { didReply: true, decision: "tool_then_ai", reason: "Veículo não atendido pela política", silence: false };
            }
            await persistOilFlowState(ctx.conversationId, conversationMetadata, {
              awaitingOilYesNo: false,
              awaitingOilSpec: false,
              awaitingOilScheduleConfirmation: true,
            });
            await sendMessage(ctx.conversationId, oilReply.reply);
            return { didReply: true, decision: "tool_then_ai", reason: "Óleo extraído; oferecendo agendamento", silence: false };
          }
          if (missingVehicle.length > 0 || !hasModelAndYear) {
            await persistOilFlowState(ctx.conversationId, conversationMetadata, {
              awaitingOilYesNo: false,
              awaitingOilSpec: false,
              awaitingOilScheduleConfirmation: false,
              awaitingOilVehicle: true,
            });
            await persistReservationContext(ctx.conversationId, conversationMetadata, {
              serviceName: "Troca de Óleo",
              productName: reservationContext.productName,
            });
            await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
            const askVehicle = buildMissingVehicleRequiredReply(
              missingVehicle.length > 0 ? missingVehicle : (["modelo", "ano"] as ("modelo" | "ano")[])
            );
            const pricePart = oilReply.reply.split("Vamos agendar")[0]?.trim() ?? oilReply.reply;
            await sendMessage(
              ctx.conversationId,
              `${pricePart}. Para seguir com o agendamento, ${askVehicle}`
            );
            return { didReply: true, decision: "tool_then_ai", reason: "Óleo extraído; coletando dados do veículo", silence: false };
          }
        }
        await sendMessage(ctx.conversationId, oilReply?.reply ?? `Temos o óleo *${oilToSearch}* disponível.`);
        return { didReply: true, decision: "tool_then_ai", reason: "Óleo extraído; resposta disponibilidade", silence: false };
      }
      if (isSimpleAffirmative(ctx.messageContent)) {
        await persistOilFlowState(ctx.conversationId, conversationMetadata, {
          awaitingOilYesNo: false,
          awaitingOilSpec: true,
        });
        await sendMessage(ctx.conversationId, "Consegue me falar o óleo?");
        return { didReply: true, decision: "tool_then_ai", reason: "Cliente sabe o óleo; pedindo especificação", silence: false };
      }
      if (isSimpleNegative(ctx.messageContent) || looksLikeUnknownOilMessage(ctx.messageContent)) {
        await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_name");
        const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
        const vehiclePart =
          missingVehicle.length === 0
            ? ""
            : ` e dos dados do veículo (*${missingVehicle.map((s) => (s === "km" ? "km" : s)).join(", ").replace(/, ([^,]*)$/, " e $1")}*)`;
        await sendMessage(
          ctx.conversationId,
          `Sem problema! Antes de te encaminhar para o mecânico técnico, preciso do seu *nome*${vehiclePart}. Me envie em uma mensagem, por favor.`
        );
        return { didReply: true, decision: "tool_then_ai", reason: "Cliente não sabe o óleo; coletando nome/veículo", silence: false };
      }
      await sendMessage(
        ctx.conversationId,
        "Você sabe o óleo utilizado no motor? Responda com *sim* ou *não*."
      );
      return { didReply: true, decision: "tool_then_ai", reason: "Aguardando sim/não sobre óleo; reenviando pergunta", silence: false };
    }

    if (oilFlowState.awaitingOilSpec || detectedOilSpec || engineCode) {
      const oilToSearch = detectedOilSpec ?? ctx.knownOilSpec ?? null;
      const oilReply = await buildOilAvailabilityReply(
        ctx.organizationId,
        oilToSearch,
        engineCode,
        ctx.messageContent
      );
      if (oilReply?.status === "out_of_stock") {
        if (oilToSearch) await saveContactMemory(ctx.contactId, "vehicle_oil_spec", oilToSearch);
        await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
        await sendMessage(
          ctx.conversationId,
          `No momento não temos o óleo *${oilReply.productName}* disponível em estoque. Posso te encaminhar para um mecânico técnico verificar a disponibilidade e agendar?`
        );
        return { didReply: true, decision: "tool_then_ai", reason: "Óleo sem estoque; oferecendo encaminhamento", silence: false };
      }
      if (oilReply?.status === "available") {
        if (oilToSearch) await saveContactMemory(ctx.contactId, "vehicle_oil_spec", oilToSearch);
        const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
        const hasModelAndYear = !!(ctx.vehicleSlots?.modelo && ctx.vehicleSlots?.ano);
        if (hasModelAndYear && missingVehicle.length <= 1) {
          const vehiclePolicyDecision = evaluateVehicleServicePolicy(
            ctx.vehicleServicePolicy,
            ctx.vehicleSlots ?? {}
          );
          if (vehiclePolicyDecision.blocked && vehiclePolicyDecision.reason) {
            await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
            await sendMessage(
              ctx.conversationId,
              `${vehiclePolicyDecision.reason}\n\nPosso te encaminhar para um mecânico técnico verificar outras opções.`
            );
            return { didReply: true, decision: "tool_then_ai", reason: "Veículo não atendido pela política", silence: false };
          }
        }
        if (!hasModelAndYear || missingVehicle.length > 0) {
          await persistOilFlowState(ctx.conversationId, conversationMetadata, {
            awaitingOilYesNo: false,
            awaitingOilSpec: false,
            awaitingOilScheduleConfirmation: false,
            awaitingOilVehicle: true,
          });
          await persistReservationContext(ctx.conversationId, conversationMetadata, {
            serviceName: "Troca de Óleo",
            productName: reservationContext.productName,
          });
          await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
          const askVehicle = buildMissingVehicleRequiredReply(
            missingVehicle.length > 0 ? missingVehicle : (["modelo", "ano"] as ("modelo" | "ano")[])
          );
          const pricePart = oilReply.reply.split("Vamos agendar")[0]?.trim() ?? oilReply.reply;
          await sendMessage(
            ctx.conversationId,
            `${pricePart}. Para seguir com o agendamento, ${askVehicle}`
          );
          return { didReply: true, decision: "tool_then_ai", reason: "Óleo encontrado; coletando dados do veículo antes de agendamento", silence: false };
        }
        await persistOilFlowState(ctx.conversationId, conversationMetadata, {
          awaitingOilYesNo: false,
          awaitingOilSpec: false,
          awaitingOilScheduleConfirmation: true,
        });
        await sendMessage(ctx.conversationId, oilReply.reply);
        return { didReply: true, decision: "tool_then_ai", reason: "Óleo encontrado; oferecendo agendamento", silence: false };
      }
      if (oilFlowState.awaitingOilSpec) {
        await sendMessage(ctx.conversationId, "Não encontrei esse óleo no cadastro. Consegue me falar o tipo? (ex.: 5W30)?");
        return { didReply: true, decision: "tool_then_ai", reason: "Óleo não encontrado; pedindo novamente", silence: false };
      }
    }

    if (shouldAskOilQualification(intentProbeText) && !oilFlowState.awaitingUnknownOilConfirmation) {
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Troca de Óleo",
        productName: reservationContext.productName,
      });
      await persistOilFlowState(ctx.conversationId, conversationMetadata, {
        awaitingOilYesNo: true,
      });
      await sendMessage(
        ctx.conversationId,
        "Você sabe o óleo utilizado no motor? Responda com *sim* ou *não*."
      );
      return { didReply: true, decision: "tool_then_ai", reason: "Troca de óleo; perguntando se sabe o tipo", silence: false };
    }
  }

  if (
    ctx.usesVehicleSlots &&
    looksLikeDirectHumanMechanicalIssue(ctx.messageContent) &&
    !isOilExchangeIntent(intentProbeText)
  ) {
    await persistReservationContext(ctx.conversationId, conversationMetadata, {
      serviceName: "Verificação",
      productName: reservationContext.productName,
    });
    const extractedIssueVehicle = extractVehicleSlotsFromText(ctx.messageContent);
    const mergedIssueVehicle = mergeVehicleSlots(
      ctx.vehicleSlots ?? {},
      extractedIssueVehicle
    );
    const missingIssueVehicle = getMissingSlots(mergedIssueVehicle);
    const inferredIssueName = !contactName
      ? extractCustomerName(ctx.messageContent, {
          allowSingleWord: true,
          blockedValues: [mergedIssueVehicle.modelo ?? ""],
        })
      : null;
    if (!contactName && inferredIssueName) {
      await db
        .update(contacts)
        .set({ name: inferredIssueName, updatedAt: new Date() })
        .where(eq(contacts.id, ctx.contactId));
      contactName = inferredIssueName;
    }

    if (
      JSON.stringify(mergedIssueVehicle) !== JSON.stringify(ctx.vehicleSlots ?? {})
    ) {
      await db
        .update(conversations)
        .set({
          conversationStateMetadata: {
            ...conversationMetadata,
            vehicleSlots: mergedIssueVehicle,
            vehicleSlotsUpdatedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, ctx.conversationId));
      if (mergedIssueVehicle.modelo) {
        await saveContactMemory(ctx.contactId, "vehicle_model", mergedIssueVehicle.modelo);
      }
      if (mergedIssueVehicle.ano) {
        await saveContactMemory(ctx.contactId, "vehicle_year", String(mergedIssueVehicle.ano));
      }
      if (mergedIssueVehicle.km) {
        await saveContactMemory(ctx.contactId, "vehicle_km", String(mergedIssueVehicle.km));
      }
    }

    if (!contactName || missingIssueVehicle.length > 0) {
      if (!contactName && missingIssueVehicle.length > 0) {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_name");
        const vehiclePart =
          missingIssueVehicle.length === 0
            ? ""
            : ` e os dados do veículo (${missingIssueVehicle.map((s) => `*${s}*`).join(", ").replace(/, ([^,]*)$/, " e $1")})`;
        await sendMessage(
          ctx.conversationId,
          `Antes de eu te encaminhar para um mecânico técnico, preciso registrar seu *nome*${vehiclePart}. Me envie em uma mensagem, por favor.`
        );
      } else if (!contactName) {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_name");
        await sendMessage(
          ctx.conversationId,
          "Antes de eu te encaminhar para um mecânico técnico, me informe seu *nome*, por favor."
        );
      } else {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
        await sendMessage(
          ctx.conversationId,
          `Perfeito, *${contactName.trim()}*. Antes de eu te encaminhar para o mecânico técnico, ${buildMissingVehicleInfoReply(missingIssueVehicle)}`
        );
      }
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Problema mecânico detectado; coletando nome e dados do veículo antes do handoff",
        silence: false,
      };
    }

    await sendMessage(
      ctx.conversationId,
      "Entendi. Isso parece um problema mecânico e vou te encaminhar agora para um mecânico técnico te atender da forma correta."
    );
    const handoff = await handoffToHuman(
      ctx.conversationId,
      ctx.organizationId,
      "Cliente descreveu problema mecânico; encaminhamento técnico imediato"
    );
    if (handoff.success) {
      await db
        .update(conversations)
        .set({
          aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, ctx.conversationId));
    }
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "direct_handoff_mechanical_issue",
      decision: "human_only",
      reason: "Problema mecânico detectado; handoff imediato",
      traceId: params.traceId,
      stage: "orchestrator.handoff",
      decisionCode: "DIRECT_HANDOFF_MECHANICAL_ISSUE",
      durationMs: Date.now() - startedAt,
      metadata: {
        messageContent: ctx.messageContent,
      },
    });
    return {
      didReply: true,
      decision: "human_only",
      reason: "Problema mecânico encaminhado para técnico",
      silence: false,
    };
  }

  if (profileUpdateFlow.awaitingConfirmation) {
    const knownVehicle = ctx.vehicleSlots ?? {};
    const extractedNew = extractVehicleSlotsFromText(ctx.messageContent);
    const norm = (s: string | undefined) => (s ?? "").toLowerCase().trim();
    const hasNewVehicleInfo =
      (extractedNew.modelo && norm(extractedNew.modelo) !== norm(knownVehicle.modelo)) ||
      (extractedNew.ano && extractedNew.ano !== knownVehicle.ano) ||
      !!extractedNew.km;

    if (hasNewVehicleInfo) {
      const merged = mergeVehicleSlots(knownVehicle, extractedNew);
      const missing = getMissingSlots(merged);
      await persistProfileUpdateFlowState(ctx.conversationId, conversationMetadata, null);
      if (missing.length === 0) {
        await db
          .update(conversations)
          .set({
            conversationStateMetadata: {
              ...conversationMetadata,
              vehicleSlots: merged,
              vehicleSlotsUpdatedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));
        if (merged.modelo) await saveContactMemory(ctx.contactId, "vehicle_model", merged.modelo);
        if (merged.ano) await saveContactMemory(ctx.contactId, "vehicle_year", String(merged.ano));
        if (merged.km) await saveContactMemory(ctx.contactId, "vehicle_km", String(merged.km));
        const naturalVehicle = formatVehicleForNaturalSpeech(merged);
        await sendMessage(
          ctx.conversationId,
          `Anotado: *${naturalVehicle}*. Confirmado em meu sistema. Como posso te ajudar agora?`
        );
        await persistIntakeStage(ctx.conversationId, conversationMetadata, null);
      } else {
        await db
          .update(conversations)
          .set({
            conversationStateMetadata: {
              ...conversationMetadata,
              vehicleSlots: merged,
              vehicleSlotsUpdatedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));
        if (merged.modelo) await saveContactMemory(ctx.contactId, "vehicle_model", merged.modelo);
        if (merged.ano) await saveContactMemory(ctx.contactId, "vehicle_year", String(merged.ano));
        if (merged.km) await saveContactMemory(ctx.contactId, "vehicle_km", String(merged.km));
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
        const singleAsk: Record<string, string> = {
          modelo: "Qual é o *modelo* do veículo?",
          ano: "Qual é o *ano* do veículo?",
          km: "Qual é a *quilometragem* do veículo?",
        };
        const labels = missing.map((m) => (m === "km" ? "quilometragem (km)" : m));
        const askMissing =
          missing.length === 1
            ? singleAsk[missing[0]] ?? `Me informe *${missing[0]}*.`
            : labels.length === 2
              ? `Me informe *${labels[0]}* e *${labels[1]}*.`
              : `Me informe *${labels.slice(0, -1).join("*, *")} e *${labels[labels.length - 1]}*.`;
        await sendMessage(
          ctx.conversationId,
          `Vou alterar em meu sistema que você mudou de carro. ${askMissing}`
        );
      }
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente informou novo veículo; extraído e solicitando dados faltantes",
        silence: false,
      };
    }

    if (isSimpleNegative(ctx.messageContent) || looksLikeVehicleDidNotChange(ctx.messageContent)) {
      await persistProfileUpdateFlowState(
        ctx.conversationId,
        conversationMetadata,
        null
      );
      let continuationPrompt = "Perfeito, confirmado. Como posso te ajudar agora?";
      if (intakeStage === "awaiting_need") {
        continuationPrompt = `Perfeito, confirmado. ${buildNeedDiscoveryPrompt(intentProbeText)}`;
      } else if (intakeStage === "awaiting_issue") {
        continuationPrompt = "Perfeito, confirmado. Pode me explicar qual é a sua dúvida/situação do veículo?";
      }
      await sendMessage(ctx.conversationId, continuationPrompt);
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente confirmou que não mudou de carro",
        silence: false,
      };
    }

    if (isSimpleAffirmative(ctx.messageContent) || looksLikeVehicleChanged(ctx.messageContent)) {
      await persistProfileUpdateFlowState(
        ctx.conversationId,
        conversationMetadata,
        null
      );
      await persistIntakeStage(
        ctx.conversationId,
        conversationMetadata,
        "awaiting_vehicle"
      );
      const missingNewVehicle = getMissingSlots({});
      await sendMessage(
        ctx.conversationId,
        `Vou alterar em meu sistema que você mudou de carro. ${buildMissingVehicleRequiredReply(missingNewVehicle)}`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente confirmou que mudou de carro; solicitando novos dados",
        silence: false,
      };
    }

    await sendMessage(
      ctx.conversationId,
      "Sei sim, você tem um *" +
        formatVehicleForNaturalSpeech(knownVehicle) +
        "*, ou você mudou de carro?"
    );
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Aguardando confirmação sobre mudança de veículo",
      silence: false,
    };
  }

  if (hasActiveFlow && looksLikeGenericFlowMessage(ctx.messageContent)) {
    const continuationReply = buildActiveFlowContinuationReply(intentProbeText);

    if (continuationReply) {
      await sendMessage(ctx.conversationId, continuationReply);
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "active_flow_continuation",
        decision: "tool_then_ai",
        reason: "Mensagem genérica recebida durante fluxo ativo; mantendo continuidade",
        traceId: params.traceId,
        stage: "orchestrator.active_flow",
        decisionCode: "ACTIVE_FLOW_CONTINUATION",
        durationMs: Date.now() - startedAt,
        metadata: {
          conversationState: ctx.conversationState,
          intakeStage,
          reservationCollectionStage: reservationFlow.collectionStage ?? null,
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Continuidade de fluxo ativo priorizada",
        silence: false,
      };
    }
  }

  if (ctx.usesVehicleSlots && looksLikeServiceCoverageQuestion(intentProbeText)) {
    const offeredServices = (ctx.offeredServices ?? []).map((service) => service.trim()).filter(Boolean);
    if (offeredServices.length > 0) {
      const askedService = detectAskedOfferedService(intentProbeText, offeredServices);
      if (askedService) {
        await sendMessage(
          ctx.conversationId,
          `Sim, trabalhamos com *${askedService}*.\n\nVou te encaminhar agora para o atendimento humano para te passar o orçamento certinho.`
        );
        const handoff = await handoffToHuman(
          ctx.conversationId,
          ctx.organizationId,
          `Cliente perguntou sobre serviço (${askedService}); direcionado para orçamento humano`
        );
        if (handoff.success) {
          await db
            .update(conversations)
            .set({
              aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, ctx.conversationId));
        }
        return {
          didReply: true,
          decision: "human_only",
          reason: "Serviço oferecido confirmado; handoff para orçamento",
          silence: false,
        };
      }

      await sendMessage(
        ctx.conversationId,
        "No momento não identificamos esse serviço na nossa lista de atendimento. Se quiser, me diga o serviço exato que você precisa que eu confirmo com o time."
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Serviço consultado não está na lista configurada",
        silence: false,
      };
    }
  }
  if (ctx.usesVehicleSlots && looksLikeVehicleCoverageQuestion(intentProbeText)) {
    const extractedQuestionSlots = extractVehicleSlotsFromText(intentProbeText);
    const askedYear = extractedQuestionSlots.ano ?? null;
    const askedModelRaw = extractedQuestionSlots.modelo ?? extractBrandMention(intentProbeText);
    const askedModel = askedModelRaw ? normalizeVehicleModelKey(askedModelRaw) : "";
    const policy = ctx.vehicleServicePolicy ?? {};

    if (askedModel && !askedYear) {
      await sendMessage(
        ctx.conversationId,
        `Consigo te confirmar sim. Me informa o *ano* do ${prettifyVehicleLabel(askedModel)} para eu validar certinho na nossa política de atendimento.`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Pergunta de cobertura por modelo sem ano; solicitando ano",
        silence: false,
      };
    }

    if (askedYear || askedModel) {
      const decision = evaluateVehicleServicePolicy(policy, {
        modelo: askedModel || undefined,
        ano: askedYear || undefined,
      });
      const response = decision.blocked
        ? `${decision.reason}\n\nSe preferir, me passe outro veículo (modelo e ano) que eu verifico na hora.`
        : "Sim, esse veículo está dentro da nossa política de atendimento.";
      await sendMessage(ctx.conversationId, response);
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Pergunta de cobertura por modelo/ano respondida",
        silence: false,
      };
    }

    await sendMessage(
      ctx.conversationId,
      buildVehiclePolicySummaryText(policy)
    );
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Pergunta geral sobre veículos atendidos",
      silence: false,
    };
  }
  const isReservationProfileCollection =
    ctx.reservationsEnabled && ctx.usesVehicleSlots && !contactName;
  const isPendingWithoutName = !!ctx.pendingReservation && !contactName;
  const allowSingleWordName =
    isPendingWithoutName || isReservationProfileCollection || isAwaitingNameStage;
  const explicitNameIntro = hasExplicitNameIntro(intentProbeText);
  const wantsNameUpdate = !!contactName && explicitNameIntro;
  const hasFullVehicleProfileHere = hasAllVehicleSlots(ctx.vehicleSlots ?? {});
  const canCaptureNameNow =
    (!contactName &&
      (explicitNameIntro ||
        isCollectProfileStage ||
        isAwaitingNameStage ||
        isPendingWithoutName ||
        (hasActiveOilFlow && hasFullVehicleProfileHere))) ||
    wantsNameUpdate;
  let inferredName: string | null = null;
  if (canCaptureNameNow) {
    inferredName = extractCustomerName(intentProbeText, {
      allowSingleWord: allowSingleWordName,
      blockedValues: [ctx.vehicleSlots?.modelo ?? ""],
    });
  }
  // Fallback: se houver conflito com modelo extraído, tenta novamente sem bloqueio.
  // Isso evita loop em casos como "Mateus" ser confundido com modelo.
  if (!inferredName && !contactName && canCaptureNameNow) {
    inferredName = extractCustomerName(intentProbeText, {
      allowSingleWord: allowSingleWordName,
    });
  }
  // Fallback: mensagem combinada com data/hora (ex.: "pode ser hoje a tarde Mateus").
  // extractCustomerName retorna null por containsDateOrTimeHint; tenta extrair do último token.
  if (
    !inferredName &&
    !contactName &&
    canCaptureNameNow &&
    allowSingleWordName &&
    containsDateOrTimeHint(intentProbeText)
  ) {
    const lastWord = intentProbeText.trim().split(/\s+/).pop();
    if (lastWord && isLikelySingleWordHumanName(lastWord)) {
      const fromLastWord = extractCustomerName(lastWord, {
        allowSingleWord: true,
        blockedValues: [ctx.vehicleSlots?.modelo ?? ""],
      });
      if (fromLastWord) inferredName = fromLastWord;
    }
  }
  const latestMessageLooksLikeSingleName = isLikelySingleWordHumanName(
    ctx.messageContent
  );
  if (isAwaitingNameStage && latestMessageLooksLikeSingleName) {
    const latestMessageName = extractCustomerName(ctx.messageContent, {
      allowSingleWord: true,
      blockedValues: [ctx.vehicleSlots?.modelo ?? ""],
    });
    if (latestMessageName) {
      inferredName = latestMessageName;
    }
  }
  const justCapturedName = !contactName && !!inferredName;
  const detectedOilSpec = extractOilSpec(intentProbeText);
  if (detectedOilSpec) {
    await saveContactMemory(ctx.contactId, "vehicle_oil_spec", detectedOilSpec);
  }
  const knownOilSpec = detectedOilSpec ?? ctx.knownOilSpec ?? null;
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
  const missingVehicleProfile = ctx.usesVehicleSlots
    ? getMissingSlots(ctx.vehicleSlots ?? {})
    : [];
  const missingNameProfile = !contactName;
  const likelySingleWordName = isLikelySingleWordHumanName(intentProbeText);
  const hasFullVehicleProfile = hasAllVehicleSlots(ctx.vehicleSlots ?? {});
  const currentVehicleSignature = buildVehicleSignature(ctx.vehicleSlots ?? {});
  const hasKnownModelAndYear = !!(ctx.vehicleSlots?.modelo && ctx.vehicleSlots?.ano);
  const vehicleSlotsFromCurrentMessage = extractVehicleSlotsFromText(intentProbeText);
  const hasVehicleInfoInCurrentMessage = Boolean(
    vehicleSlotsFromCurrentMessage.modelo ||
      vehicleSlotsFromCurrentMessage.ano ||
      vehicleSlotsFromCurrentMessage.km
  );
  const hasAutomotiveIntentNow =
    looksLikeReservationIntent(intentProbeText) ||
    looksLikeCatalogIntent(intentProbeText) ||
    looksLikeCarProblemOrRepairIntent(intentProbeText) ||
    looksLikeDirectHumanMechanicalIssue(intentProbeText) ||
    isRevisionServiceIntent(intentProbeText) ||
    shouldAskOilQualification(intentProbeText);
  const vehiclePolicyCandidateSlots = mergeVehicleSlots(
    ctx.vehicleSlots ?? {},
    vehicleSlotsFromCurrentMessage
  );
  const shouldEvaluateVehiclePolicy =
    !!ctx.usesVehicleSlots && (hasVehicleInfoInCurrentMessage || hasAutomotiveIntentNow);
  const vehiclePolicyDecision = shouldEvaluateVehiclePolicy
    ? evaluateVehicleServicePolicy(
        ctx.vehicleServicePolicy,
        vehiclePolicyCandidateSlots
      )
    : { blocked: false, reason: null as string | null };
  if (vehiclePolicyDecision.blocked && vehiclePolicyDecision.reason) {
    const policyReply = `${vehiclePolicyDecision.reason}\n\nSe quiser, posso te direcionar para confirmar opções de atendimento humano.`;
    await sendMessage(ctx.conversationId, policyReply);
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "vehicle_policy_blocked",
      decision: "tool_then_ai",
      reason: "Veículo bloqueado pela política da organização",
      traceId: params.traceId,
      stage: "orchestrator.vehicle_policy",
      decisionCode: "VEHICLE_POLICY_BLOCKED",
      durationMs: Date.now() - startedAt,
      metadata: {
        model: vehiclePolicyCandidateSlots.modelo ?? null,
        year: vehiclePolicyCandidateSlots.ano ?? null,
        minAllowedYear: ctx.vehicleServicePolicy?.minAllowedYear ?? null,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Veículo bloqueado pela política de atendimento",
      silence: false,
    };
  }
  const rawVehicleSlotsUpdatedAt =
    typeof conversationMetadata.vehicleSlotsUpdatedAt === "string"
      ? conversationMetadata.vehicleSlotsUpdatedAt
      : null;
  const parsedVehicleSlotsUpdatedAt = rawVehicleSlotsUpdatedAt
    ? new Date(rawVehicleSlotsUpdatedAt)
    : null;
  const hasRecentVehicleUpdate =
    !!parsedVehicleSlotsUpdatedAt &&
    !Number.isNaN(parsedVehicleSlotsUpdatedAt.getTime()) &&
    Date.now() - parsedVehicleSlotsUpdatedAt.getTime() < VEHICLE_CONFIRMATION_STALE_MS;

  if (
    intakeStage === "awaiting_name" &&
    !hasActiveOilFlow &&
    !hasActiveReservationFlow
  ) {
    const suppressRepeatedNamePrompt = await shouldSuppressRepeatedNamePrompt(
      ctx.conversationId,
      intentProbeText,
      explicitNameIntro
    );
    if (suppressRepeatedNamePrompt && !justCapturedName && !latestMessageLooksLikeSingleName) {
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "name_prompt_suppressed",
        decision: "tool_then_ai",
        reason: "Evita repetir pergunta de nome em mensagens curtas seguidas",
        traceId: params.traceId,
        stage: "orchestrator.profile",
        decisionCode: "NAME_PROMPT_SUPPRESSED",
        durationMs: Date.now() - startedAt,
        metadata: {
          intentProbeText,
        },
      });
      return {
        didReply: false,
        decision: "tool_then_ai",
        reason: "Pergunta de nome suprimida para evitar repetição",
        silence: true,
      };
    }

    if (!justCapturedName && looksLikeInvalidNameAnswer(ctx.messageContent)) {
      await sendMessage(
        ctx.conversationId,
        "Não consegui identificar seu nome. Pode me informar seu *nome*, por favor?"
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "invalid_name_answer",
        decision: "tool_then_ai",
        reason: "Resposta inválida durante coleta de nome",
        traceId: params.traceId,
        stage: "orchestrator.profile",
        decisionCode: "INVALID_NAME_ANSWER",
        durationMs: Date.now() - startedAt,
        metadata: {
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitando nome após resposta inválida",
        silence: false,
      };
    }
  }

  if (isAwaitingNameStage && justCapturedName && contactName) {
    if (reservationContext.serviceName === "Verificação" && ctx.usesVehicleSlots) {
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");

      if (hasModelAndYearProfile && ctx.vehicleSlots?.km) {
        const vehicleLabel = [
          ctx.vehicleSlots?.modelo ? ctx.vehicleSlots.modelo : null,
          ctx.vehicleSlots?.ano ? String(ctx.vehicleSlots.ano) : null,
        ]
          .filter(Boolean)
          .join(" ");
        await sendMessage(
          ctx.conversationId,
          `Perfeito, *${contactName}*. Já salvei seus dados e o veículo *${vehicleLabel}*. Vou encaminhar agora para um mecânico técnico verificar seu caso.`
        );
        const handoff = await handoffToHuman(
          ctx.conversationId,
          ctx.organizationId,
          "Cliente descreveu problema no carro; nome confirmado e dados completos coletados"
        );
        if (handoff.success) {
          await db
            .update(conversations)
            .set({
              aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, ctx.conversationId));
        }
        return {
          didReply: true,
          decision: "human_only",
          reason: "Nome capturado com verificação e dados completos; handoff técnico",
          silence: false,
        };
      }

      if (hasModelAndYearProfile) {
        const vehicleLabel = [
          ctx.vehicleSlots?.modelo ? ctx.vehicleSlots.modelo : null,
          ctx.vehicleSlots?.ano ? String(ctx.vehicleSlots.ano) : null,
        ]
          .filter(Boolean)
          .join(" ");
        await sendMessage(
          ctx.conversationId,
          `Perfeito, *${contactName}*. Registrei seu veículo como *${vehicleLabel}*.`
        );
        await sendMessage(
          ctx.conversationId,
          "Você consegue me mandar a *km* do seu carro? Se não souber, tudo bem que eu continuo seu atendimento."
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Nome capturado com verificação; aguardando km para encaminhamento",
          silence: false,
        };
      }

      await sendMessage(
        ctx.conversationId,
        `Perfeito, *${contactName}*. Agora me informe o *modelo* e o *ano* do veículo. Se souber, me passe também a *km*.`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Nome capturado com verificação; solicitando dados do veículo",
        silence: false,
      };
    }

    // Cliente já descreveu o problema antes de informar o nome (ex: "meu carro ta vazando óleo" + "Mateus")
    if (
      ctx.usesVehicleSlots &&
      (looksLikeDirectHumanMechanicalIssue(intentProbeText) || looksLikeCarProblemOrRepairIntent(intentProbeText))
    ) {
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Verificação",
        productName: reservationContext.productName,
      });
      const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
      if (missingVehicle.length > 0) {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
        await sendMessage(
          ctx.conversationId,
          `Prazer, *${contactName}*! Entendi seu caso. Antes de te encaminhar para um mecânico técnico, ${buildMissingVehicleRequiredReply(missingVehicle)}`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Problema já descrito; coletando dados do veículo para encaminhamento",
          silence: false,
        };
      }
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
      await sendMessage(
        ctx.conversationId,
        `Prazer, *${contactName}*! Vou encaminhar agora seu atendimento para um mecânico técnico analisar esse problema.`
      );
      const handoff = await handoffToHuman(
        ctx.conversationId,
        ctx.organizationId,
        "Cliente descreveu problema (ex: vazando óleo); nome confirmado e dados do veículo completos"
      );
      if (handoff.success) {
        await db
          .update(conversations)
          .set({
            aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));
      }
      return {
        didReply: true,
        decision: "human_only",
        reason: "Problema descrito antes do nome; handoff técnico",
        silence: false,
      };
    }

    await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_need");
    const needPrompt = buildNeedDiscoveryPrompt(intentProbeText);
    await sendMessage(
      ctx.conversationId,
      `Prazer, *${contactName}*! ${needPrompt}`
    );
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "intake_name_captured",
      decision: "tool_then_ai",
      reason: "Nome capturado no onboarding de identificação",
      traceId: params.traceId,
      stage: "orchestrator.profile",
      decisionCode: "INTAKE_NAME_CAPTURED",
      durationMs: Date.now() - startedAt,
      metadata: {
        contactName,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Nome confirmado e onboarding continuado",
      silence: false,
    };
  }

  if (
    intakeStage === "awaiting_vehicle" &&
    !hasActiveOilFlow &&
    !hasActiveReservationFlow
  ) {
    const requiresFullVehicleProfile =
      reservationContext.serviceName === "Revisão" ||
      reservationContext.serviceName === "Troca de Óleo";
    const hasVehicleProfileForCurrentNeed = requiresFullVehicleProfile
      ? hasFullVehicleProfile
      : hasModelAndYearProfile;
    if (hasVehicleProfileForCurrentNeed) {
      const vehicleLabel = [
        ctx.vehicleSlots?.modelo ? ctx.vehicleSlots.modelo : null,
        ctx.vehicleSlots?.ano ? String(ctx.vehicleSlots.ano) : null,
      ]
        .filter(Boolean)
        .join(" ");
      const kmHint = ctx.vehicleSlots?.km ? "" : "\nSe souber, me passe também o *km* para deixar o orçamento mais preciso.";

      if (reservationContext.serviceName === "Revisão") {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
        await sendMessage(
          ctx.conversationId,
          `Perfeito, registrei seu veículo como *${vehicleLabel}*.\nVou direcionar agora seu atendimento de revisão para um mecânico técnico.`
        );
        const handoff = await handoffToHuman(
          ctx.conversationId,
          ctx.organizationId,
          "Cliente solicitou revisão; dados do veículo coletados"
        );
        if (handoff.success) {
          await db
            .update(conversations)
            .set({
              aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, ctx.conversationId));
        }
        return {
          didReply: true,
          decision: "human_only",
          reason: "Revisão com dados completos; handoff técnico",
          silence: false,
        };
      }

      if (reservationContext.serviceName === "Troca de Óleo") {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
        await sendMessage(
          ctx.conversationId,
          `Perfeito, registrei seu veículo como *${vehicleLabel}*.${kmHint}\nVocê sabe qual óleo é utilizado no carro? Se não souber, me responda *não sei* que eu direciono para o mecânico técnico.`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Óleo identificado; seguindo com qualificação após dados completos do veículo",
          silence: false,
        };
      }

      if (reservationContext.serviceName === "Verificação") {
        const hasKm = !!ctx.vehicleSlots?.km;
        const providedModelOrYearNow = Boolean(
          vehicleSlotsFromCurrentMessage.modelo || vehicleSlotsFromCurrentMessage.ano
        );
        if (hasKm) {
          await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
          await sendMessage(
            ctx.conversationId,
            `Perfeito, já salvei aqui os dados do veículo (${vehicleLabel}). Vou encaminhar agora para um mecânico técnico verificar esse problema.`
          );
          const handoff = await handoffToHuman(
            ctx.conversationId,
            ctx.organizationId,
            "Cliente descreveu problema no carro; dados mínimos coletados para atendimento técnico"
          );
          if (handoff.success) {
            await db
              .update(conversations)
              .set({
                aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
                updatedAt: new Date(),
              })
              .where(eq(conversations.id, ctx.conversationId));
          }
          return {
            didReply: true,
            decision: "human_only",
            reason: "Verificação com modelo, ano e km; handoff técnico",
            silence: false,
          };
        }

        if (isSimpleAffirmative(ctx.messageContent)) {
          await sendMessage(
            ctx.conversationId,
            "Perfeito, fico no aguardo da quilometragem."
          );
          return {
            didReply: true,
            decision: "tool_then_ai",
            reason: "Aguardando km do veículo no fluxo de verificação",
            silence: false,
          };
        }

        if (looksLikeUnknownKm(ctx.messageContent)) {
          await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
          await sendMessage(
            ctx.conversationId,
            `Sem problemas. Com os dados que já tenho do veículo (${vehicleLabel}), vou encaminhar agora para um mecânico técnico verificar seu caso.`
          );
          const handoff = await handoffToHuman(
            ctx.conversationId,
            ctx.organizationId,
            "Cliente não sabe a quilometragem; encaminhado para mecânico técnico"
          );
          if (handoff.success) {
            await db
              .update(conversations)
              .set({
                aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
                updatedAt: new Date(),
              })
              .where(eq(conversations.id, ctx.conversationId));
          }
          return {
            didReply: true,
            decision: "human_only",
            reason: "Verificação sem km; handoff técnico",
            silence: false,
          };
        }

        await sendMessage(
          ctx.conversationId,
          `Perfeito, registrei seu veículo como *${vehicleLabel}*.`
        );
        await sendMessage(
          ctx.conversationId,
          "Você consegue me mandar a *km* do seu carro?"
        );
        if (!providedModelOrYearNow) {
          await sendMessage(
            ctx.conversationId,
            "Se não souber a km, tudo bem que eu continuo seu atendimento."
          );
        }
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Verificação com modelo e ano; solicitando km de forma opcional",
          silence: false,
        };
      }

      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_need");
      const needPrompt = buildNeedDiscoveryPrompt(intentProbeText);
      await sendMessage(
        ctx.conversationId,
        `Perfeito, registrei seu veículo como *${vehicleLabel}*.${kmHint}\n${needPrompt}`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Veículo identificado; avançando para descoberta da dúvida",
        silence: false,
      };
    }

    const requiredMissing = getMissingSlots(ctx.vehicleSlots ?? {});
    const missingRequiredVehicle = requiresFullVehicleProfile
      ? requiredMissing
      : requiredMissing.filter((slot) => slot !== "km");
    const capturedModelNow = !!vehicleSlotsFromCurrentMessage.modelo;
    const capturedYearNow = !!vehicleSlotsFromCurrentMessage.ano;
    if (capturedModelNow && missingRequiredVehicle.includes("ano")) {
      await sendMessage(
        ctx.conversationId,
        requiresFullVehicleProfile
          ? "Perfeito, já anotei o *modelo*. Agora me informe o *ano* e o *km* do veículo."
          : "Perfeito, já anotei o *modelo*. Agora me informe o *ano* do veículo. Se souber, pode me passar o *km* também."
      );
    } else if (capturedYearNow && missingRequiredVehicle.includes("modelo")) {
      await sendMessage(
        ctx.conversationId,
        requiresFullVehicleProfile
          ? "Perfeito, já anotei o *ano*. Agora me informe o *modelo* e o *km* do veículo."
          : "Perfeito, já anotei o *ano*. Agora me informe o *modelo* do veículo. Se souber, pode me passar o *km* também."
      );
    } else {
      await sendMessage(
        ctx.conversationId,
        requiresFullVehicleProfile
          ? "Para continuar esse atendimento, me informe *modelo, ano e km* do veículo."
          : buildMissingVehicleRequiredReply(getMissingSlots(ctx.vehicleSlots ?? {}))
      );
    }

    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Aguardando complemento de dados do veículo",
      silence: false,
    };
  }

  if (oilFlowState.awaitingUnknownOilConfirmation) {
    if (
      looksLikeVehicleCorrectionDuringOilFlow(
        ctx.messageContent,
        ctx.vehicleSlots?.modelo
      )
    ) {
      const correctedFromMessage = extractVehicleSlotsFromText(ctx.messageContent);
      const mergedCorrectedSlots = mergeVehicleSlots(
        ctx.vehicleSlots ?? {},
        correctedFromMessage
      );
      const hasModelAndYearAfterCorrection = !!(
        mergedCorrectedSlots.modelo && mergedCorrectedSlots.ano
      );

      if (hasModelAndYearAfterCorrection) {
        const nextMetadata = {
          ...conversationMetadata,
          vehicleSlots: mergedCorrectedSlots,
          vehicleSlotsUpdatedAt: new Date().toISOString(),
        };
        await db
          .update(conversations)
          .set({
            conversationStateMetadata: nextMetadata,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));

        if (mergedCorrectedSlots.modelo) {
          await saveContactMemory(
            ctx.contactId,
            "vehicle_model",
            mergedCorrectedSlots.modelo
          );
        }
        if (mergedCorrectedSlots.ano) {
          await saveContactMemory(
            ctx.contactId,
            "vehicle_year",
            String(mergedCorrectedSlots.ano)
          );
        }
        if (mergedCorrectedSlots.km) {
          await saveContactMemory(
            ctx.contactId,
            "vehicle_km",
            String(mergedCorrectedSlots.km)
          );
        }

        const vehicleLabel = [
          mergedCorrectedSlots.modelo ?? null,
          mergedCorrectedSlots.ano ? String(mergedCorrectedSlots.ano) : null,
        ]
          .filter(Boolean)
          .join(" ");

        await sendMessage(
          ctx.conversationId,
          `Perfeito, atualizei para *${vehicleLabel}*.\nSe conseguir, me passe também o *km* para deixar o orçamento mais preciso (se não souber, tudo bem).\nVocê sabe o tipo do óleo?`
        );
        await persistOilFlowState(ctx.conversationId, conversationMetadata, {
          awaitingUnknownOilConfirmation: true,
        });
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Veículo corrigido na mesma mensagem; segue validação de óleo e km opcional",
          silence: false,
        };
      }

      await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
      await sendMessage(
        ctx.conversationId,
        "Perfeito, vamos atualizar os dados do veículo.\nMe informe o *modelo* e o *ano* do carro atual. Se conseguir, me passe também o *km* para deixar o orçamento mais preciso. Se não souber, tudo bem."
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente corrigiu o veículo durante fluxo de óleo",
        silence: false,
      };
    }

    if (isSimpleNegative(ctx.messageContent)) {
      const slots = ctx.vehicleSlots ?? {};
      const hasModelAndYear = !!(slots.modelo && slots.ano);
      await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
      if (hasModelAndYear) {
        await sendMessage(
          ctx.conversationId,
          "Perfeito, sem problema. Vou encaminhar para um mecânico técnico continuar seu atendimento e confirmar a especificação correta para o seu veículo."
        );
        const handoff = await handoffToHuman(
          ctx.conversationId,
          ctx.organizationId,
          "Cliente confirmou que não sabe o óleo; encaminhado para mecânico técnico"
        );
        if (handoff.success) {
          await db
            .update(conversations)
            .set({
              aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, ctx.conversationId));
        }
        return {
          didReply: true,
          decision: "human_only",
          reason: "Cliente confirmou que não sabe o óleo; handoff técnico 24h",
          silence: false,
        };
      }
      await sendMessage(
        ctx.conversationId,
        "Sem problema. Para eu encaminhar certinho ao mecânico técnico, me informe o *modelo* e o *ano* do veículo. Se souber o *km*, também ajuda a deixar o orçamento mais preciso."
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente não sabe óleo; solicitando modelo e ano para handoff",
        silence: false,
      };
    }

    if (isSimpleAffirmative(ctx.messageContent)) {
      await persistOilFlowState(ctx.conversationId, conversationMetadata, null);
      await sendMessage(
        ctx.conversationId,
        "Perfeito! Então me informe o tipo do óleo (ex.: *5W30* ou *10W40*) para eu seguir com o valor certinho."
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente informou que sabe o óleo; solicitando especificação",
        silence: false,
      };
    }
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
    await sendMessage(
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

  const missingWorkshopVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
  const missingWorkshopRequiredVehicle = missingWorkshopVehicle.filter(
    (slot) => slot !== "km"
  );
  if (
    (looksLikeVehicleStatusInquiry(ctx.messageContent) || workshopState.awaitingVehicleDetails) &&
    !workshopState.carInShop
  ) {
    if (missingWorkshopRequiredVehicle.length > 0) {
      await persistWorkshopState(ctx.conversationId, conversationMetadata, {
        carInShop: false,
        awaitingVehicleDetails: true,
      });
      await sendMessage(
        ctx.conversationId,
        `Antes de direcionar para o mecânico técnico, preciso registrar os dados do veículo.\n${buildMissingVehicleRequiredReply(
          missingWorkshopVehicle
        )}`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitação de status com dados do veículo não registrados",
        silence: false,
      };
    }

    await persistWorkshopState(ctx.conversationId, conversationMetadata, {
      carInShop: true,
      awaitingVehicleDetails: false,
    });
    await sendMessage(
      ctx.conversationId,
      "Perfeito, vou direcionar você para um mecânico técnico verificar a situação do seu carro."
    );
    const handoff = await handoffToHuman(
      ctx.conversationId,
      ctx.organizationId,
      "Cliente solicitou status do carro; encaminhado para mecânico técnico"
    );
    if (handoff.success) {
      await db
        .update(conversations)
        .set({
          aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, ctx.conversationId));
    }
    return {
      didReply: true,
      decision: "human_only",
      reason: "Status de carro solicitado; handoff técnico com pausa de IA",
      silence: false,
    };
  }

  if (workshopState.carInShop) {
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "workshop_mode_silence",
      decision: "human_only",
      reason: "Conversa marcada com carro na mecânica; IA permanece silenciada",
      traceId: params.traceId,
      stage: "orchestrator.decision",
      decisionCode: "WORKSHOP_MODE_SILENCE",
      durationMs: Date.now() - startedAt,
      metadata: {
        messageContent: ctx.messageContent,
      },
    });
    return {
      didReply: false,
      decision: "human_only",
      reason: "Carro marcado na mecânica; aguardando atendimento humano",
      silence: true,
    };
  }

  const asksKnownName = looksLikeAskKnownName(ctx.messageContent);
  const asksKnownVehicle = looksLikeAskKnownVehicle(ctx.messageContent);
  const asksBotName = looksLikeAskBotName(ctx.messageContent);
  if (asksBotName) {
    const botName = ctx.businessProfile?.botName?.trim() || "assistente da oficina";
    await sendMessage(
      ctx.conversationId,
      `Prazer! Eu sou *${botName}*. Como posso te ajudar hoje?`
    );
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Cliente perguntou o nome do bot",
      silence: false,
    };
  }

  if (
    ctx.usesVehicleSlots &&
    looksLikeCarProblemOrRepairIntent(intentProbeText) &&
    contactName &&
    !hasModelAndYearProfile
  ) {
    const knownName = contactName.trim();
    await persistReservationContext(ctx.conversationId, conversationMetadata, {
      serviceName: "Verificação",
      productName: reservationContext.productName,
    });
    await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
    await sendMessage(
      ctx.conversationId,
      `Perfeito *${knownName}*, me informa o *modelo* e o *ano* do veículo para que eu possa verificar a disponibilidade de nosso agendamento. Se souber, pode me passar também a *quilometragem*.`
    );
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "car_problem_direct_vehicle_request",
      decision: "tool_then_ai",
      reason: "Cliente descreveu problema no carro; solicitando dados do veículo para agendamento",
      traceId: params.traceId,
      stage: "orchestrator.intake",
      decisionCode: "CAR_PROBLEM_DIRECT_VEHICLE_REQUEST",
      durationMs: Date.now() - startedAt,
      metadata: { messageContent: ctx.messageContent },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Problema no carro identificado; solicitando modelo e ano (km opcional)",
      silence: false,
    };
  }

  const isAskVehicleButCarProblem =
    asksKnownVehicle && looksLikeCarProblemOrRepairIntent(ctx.messageContent);
  if ((asksKnownName || asksKnownVehicle) && !isAskVehicleButCarProblem) {
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
    const wantsVehicleUpdate = looksLikeVehicleUpdateRequest(ctx.messageContent);
    if (asksKnownName && !knownName) {
      reply = "Desculpa, ainda não sei seu nome. Qual seria o seu nome?";
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_name");
    } else if (asksKnownVehicle && hasKnownVehicle && wantsVehicleUpdate) {
      const naturalVehicle = formatVehicleForNaturalSpeech(knownVehicle);
      reply = `Sei sim, você tem um *${naturalVehicle}*. Vou atualizar. Me informe o *modelo*, *ano* e *quilometragem* do veículo atual.`;
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
      await persistProfileUpdateFlowState(ctx.conversationId, conversationMetadata, null);
    } else if (knownName && hasKnownVehicle) {
      const naturalVehicle = formatVehicleForNaturalSpeech(knownVehicle);
      reply = `Sei sim *${knownName}*, você tem um *${naturalVehicle}*, ou você mudou de carro?`;
      await persistProfileUpdateFlowState(ctx.conversationId, conversationMetadata, {
        awaitingConfirmation: true,
      });
    } else if (knownName) {
      reply = `Tenho seu nome salvo como *${knownName}*, mas ainda não tenho o veículo completo.\nDeseja cadastrar/atualizar agora? Responda *sim* ou *não*.`;
      await persistProfileUpdateFlowState(ctx.conversationId, conversationMetadata, {
        awaitingConfirmation: true,
      });
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
    } else if (hasKnownVehicle) {
      const naturalVehicle = formatVehicleForNaturalSpeech(knownVehicle);
      reply = `Sei sim, você tem um *${naturalVehicle}*, ou você mudou de carro?`;
      await persistProfileUpdateFlowState(ctx.conversationId, conversationMetadata, {
        awaitingConfirmation: true,
      });
    } else {
      reply = "Ainda não tenho seu nome e veículo salvos. Me passe, por favor: *nome, modelo, ano e km*.";
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_name");
      await persistProfileUpdateFlowState(ctx.conversationId, conversationMetadata, null);
    }

    await sendMessage(ctx.conversationId, reply);
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

  const asksInstagram = looksLikeAskInstagram(ctx.messageContent);
  const asksAddress = looksLikeAskAddress(ctx.messageContent);
  if (asksInstagram || asksAddress) {
    const instagram = ctx.businessProfile?.instagram?.trim() || "";
    const address = ctx.businessProfile?.address?.trim() || "";
    const mapsLink = ctx.businessProfile?.mapsLink?.trim() || "";
    const chunks: string[] = [];

    if (asksInstagram) {
      if (instagram) {
        chunks.push(`Nosso Instagram: *${instagram}*`);
      } else {
        chunks.push("No momento ainda não temos Instagram cadastrado.");
      }
    }

    if (asksAddress) {
      if (address) {
        chunks.push(`Nosso endereço: *${address}*`);
      } else {
        chunks.push("No momento ainda não temos endereço cadastrado.");
      }
      if (mapsLink) {
        chunks.push(`Localização no Google Maps: ${mapsLink}`);
      }
    }

    const hasModelAndYear = !!(ctx.vehicleSlots?.modelo && ctx.vehicleSlots?.ano);
    let continuationPrompt: string | null = null;
    if (intakeStage === "awaiting_name" || (!contactName && !intakeStage)) {
      continuationPrompt = `Para continuarmos, ${getRandomContinuationNameQuestion()}`;
    } else if (
      !!ctx.usesVehicleSlots &&
      !hasModelAndYear &&
      (intakeStage === "awaiting_need" || intakeStage === null)
    ) {
      continuationPrompt =
        "Perfeito. Agora me passe o *modelo* e o *ano* do veículo. Se souber, me passe também o *km*.";
    } else if (intakeStage === "awaiting_need") {
      continuationPrompt = `Perfeito. ${buildNeedDiscoveryPrompt(intentProbeText)}`;
    } else if (intakeStage === "awaiting_issue") {
      continuationPrompt = "Perfeito. Pode me explicar qual é a situação/dúvida do veículo?";
    }
    await sendMessage(ctx.conversationId, chunks.join("\n"));
    if (continuationPrompt) {
      await sendMessage(ctx.conversationId, continuationPrompt);
    }
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "business_profile_reply",
      decision: "tool_then_ai",
      reason: "Cliente solicitou dados da empresa",
      traceId: params.traceId,
      stage: "orchestrator.profile",
      decisionCode: "BUSINESS_PROFILE_REPLY",
      durationMs: Date.now() - startedAt,
      metadata: {
        asksInstagram,
        asksAddress,
        hasInstagram: !!instagram,
        hasAddress: !!address,
        hasMapsLink: !!mapsLink,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Dados da empresa retornados ao cliente",
      silence: false,
    };
  }

  if (
    vehicleConfirmation.pending &&
    vehicleConfirmation.vehicleSignature &&
    vehicleConfirmation.vehicleSignature === currentVehicleSignature &&
    isSimpleAffirmative(ctx.messageContent)
  ) {
    await persistVehicleConfirmationState(ctx.conversationId, conversationMetadata, {
      pending: false,
      confirmed: true,
      vehicleSignature: currentVehicleSignature,
    });
    await sendMessage(
      ctx.conversationId,
      "Perfeito, ótimo! Vamos seguir com esse veículo. Como posso te ajudar agora?"
    );
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Veículo confirmado pelo cliente",
      silence: false,
    };
  }

  if (
    vehicleConfirmation.pending &&
    vehicleConfirmation.vehicleSignature &&
    vehicleConfirmation.vehicleSignature === currentVehicleSignature &&
    isSimpleNegative(ctx.messageContent)
  ) {
    await persistVehicleConfirmationState(ctx.conversationId, conversationMetadata, {
      pending: false,
      confirmed: false,
      vehicleSignature: "",
    });
    await sendMessage(
      ctx.conversationId,
      "Sem problemas. Me atualize, por favor: *modelo, ano e km* do veículo atual."
    );
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Cliente negou veículo salvo; pedindo atualização",
      silence: false,
    };
  }

  const shouldAskVehicleConfirmation =
    ctx.reservationsEnabled &&
    ctx.usesVehicleSlots &&
    hasFullVehicleProfile &&
    !ctx.pendingReservation &&
    !hasVehicleInfoInCurrentMessage &&
    !hasRecentVehicleUpdate &&
    !containsDateOrTimeHint(intentProbeText) &&
    !looksLikeAskKnownName(intentProbeText) &&
    !looksLikeAskKnownVehicle(intentProbeText) &&
    (looksLikeGreeting(intentProbeText) ||
      looksLikeCatalogIntent(intentProbeText) ||
      looksLikeReservationIntent(intentProbeText));

  if (
    shouldAskVehicleConfirmation &&
    currentVehicleSignature &&
    (vehicleConfirmation.vehicleSignature !== currentVehicleSignature ||
      (!vehicleConfirmation.pending && !vehicleConfirmation.confirmed))
  ) {
    const vehicle = ctx.vehicleSlots ?? {};
    const vehicleLabel = [
      vehicle.modelo ? vehicle.modelo : null,
      vehicle.ano ? String(vehicle.ano) : null,
      vehicle.km ? `${vehicle.km} km` : null,
    ]
      .filter(Boolean)
      .join(" - ");
    await sendMessage(
      ctx.conversationId,
      `Antes de seguir, só confirmando: você continua com *${vehicleLabel}*?`
    );
    await persistVehicleConfirmationState(ctx.conversationId, conversationMetadata, {
      pending: true,
      confirmed: false,
      vehicleSignature: currentVehicleSignature,
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Confirmação ativa de veículo salvo enviada",
      silence: false,
    };
  }

  // Saudação para restaurante: fluxo simplificado (nome + opções).
  if (
    ctx.reservationsEnabled &&
    ctx.botConfig?.segment === "restaurante" &&
    looksLikeGreeting(intentProbeText) &&
    !ctx.pendingReservation &&
    !looksLikeReservationIntent(intentProbeText) &&
    !looksLikeRestaurantReservationIntent(intentProbeText)
  ) {
    const hasKnownName = !!contactName?.trim();
    const botName = ctx.businessProfile?.botName?.trim() || "";
    const botIntro = botName ? ` Me chamo *${botName}*.` : "";
    const greetingPrefix = buildAdaptiveGreeting(
      intentProbeText,
      new Date(),
      ctx.reservationSchedule?.timezone
    );
    const triageReply = !hasKnownName
      ? `${greetingPrefix}${botIntro} ${getRandomNameQuestion()}`
      : `${greetingPrefix}${botIntro} *${contactName!.trim()}*, como posso ajudar? Podemos fazer reserva de mesa, consultar cardápio ou tirar dúvidas.`;
    await sendMessage(
      ctx.conversationId,
      applyToneToText(triageReply, ctx.botConfig?.tone)
    );
    await persistIntakeStage(
      ctx.conversationId,
      conversationMetadata,
      !hasKnownName ? "awaiting_name" : null
    );
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "intake_greeting_restaurant",
      decision: "tool_then_ai",
      reason: "Saudação recebida; fluxo restaurante",
      traceId: params.traceId,
      stage: "orchestrator.reservations",
      decisionCode: "INTAKE_GREETING_RESTAURANT",
      durationMs: Date.now() - startedAt,
      metadata: { messageContent: ctx.messageContent, hasKnownName },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Saudação restaurante enviada",
      silence: false,
    };
  }

  // Abordagem inicial neutra: entende a dúvida antes de mencionar opções.
  if (
    ctx.reservationsEnabled &&
    ctx.usesVehicleSlots &&
    looksLikeGreeting(intentProbeText) &&
    !ctx.pendingReservation &&
    !looksLikeReservationIntent(intentProbeText)
  ) {
    const hasKnownName = !!contactName?.trim();
    const botName = ctx.businessProfile?.botName?.trim() || "";
    const botIntro = botName ? ` Me chamo *${botName}*.` : "";
    const greetingPrefix = buildAdaptiveGreeting(
      intentProbeText,
      new Date(),
      ctx.reservationSchedule?.timezone
    );
    const triageReply = !hasKnownName
      ? `${greetingPrefix}${botIntro} ${getRandomNameQuestion()}`
      : `${greetingPrefix}${botIntro} *${contactName!.trim()}*, qual sua dúvida?`;
    await sendMessage(
      ctx.conversationId,
      applyToneToText(triageReply, ctx.botConfig?.tone)
    );
    await persistIntakeStage(
      ctx.conversationId,
      conversationMetadata,
      !hasKnownName ? "awaiting_name" : "awaiting_need"
    );
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "intake_greeting",
      decision: "tool_then_ai",
      reason: hasKnownName
        ? "Saudação recebida; iniciando descoberta da necessidade"
        : "Saudação recebida; iniciando identificação de nome",
      traceId: params.traceId,
      stage: "orchestrator.reservations",
      decisionCode: "INTAKE_GREETING",
      durationMs: Date.now() - startedAt,
      metadata: {
        messageContent: ctx.messageContent,
        hasKnownName,
      },
    });
    return {
      didReply: true,
      decision: "tool_then_ai",
      reason: "Pergunta inicial enviada",
      silence: false,
    };
  }

  if (intakeStage === "awaiting_need" && !looksLikeReservationIntent(intentProbeText)) {
    if (looksLikeDirectHumanMechanicalIssue(intentProbeText) && ctx.usesVehicleSlots) {
      const safeContactName = (contactName ?? "cliente").trim();
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Verificação",
        productName: reservationContext.productName,
      });

      const missingRequiredVehicle = getMissingSlots(ctx.vehicleSlots ?? {}).filter(
        (slot) => slot !== "km"
      );
      const missingName = !contactName;

      if (missingName) {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_name");
        await sendMessage(
          ctx.conversationId,
          "Entendi seu caso. Antes de eu te encaminhar para um mecânico técnico, qual é o seu *nome*?"
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Caso técnico em awaiting_need; coletando nome antes do handoff",
          silence: false,
        };
      }

      if (missingRequiredVehicle.length > 0) {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
        await sendMessage(
          ctx.conversationId,
          `Entendi, *${safeContactName}*. Antes de eu te encaminhar para um mecânico técnico, ${buildMissingVehicleRequiredReply(
            getMissingSlots(ctx.vehicleSlots ?? {})
          )}`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Caso técnico em awaiting_need; coletando dados mínimos do veículo",
          silence: false,
        };
      }

      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
      await sendMessage(
        ctx.conversationId,
        `Perfeito, *${safeContactName}*. Vou encaminhar agora seu atendimento para um mecânico técnico analisar esse problema.`
      );
      const handoff = await handoffToHuman(
        ctx.conversationId,
        ctx.organizationId,
        "Cliente descreveu falha/problema complexo; encaminhado para mecânico técnico"
      );
      if (handoff.success) {
        await db
          .update(conversations)
          .set({
            aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));
      }
      return {
        didReply: true,
        decision: "human_only",
        reason: "Caso técnico complexo com dados mínimos coletados; handoff",
        silence: false,
      };
    }

    if (
      looksLikeCarProblemOrRepairIntent(intentProbeText) &&
      ctx.usesVehicleSlots &&
      hasModelAndYearProfile
    ) {
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Verificação",
        productName: reservationContext.productName,
      });
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
      const knownName = contactName?.trim() || "";
      await sendMessage(
        ctx.conversationId,
        `Perfeito *${knownName}*! Vou encaminhar agora seu atendimento para um mecânico técnico verificar esse problema no veículo.`
      );
      const handoff = await handoffToHuman(
        ctx.conversationId,
        ctx.organizationId,
        "Cliente descreveu problema no veículo; encaminhado para mecânico técnico"
      );
      if (handoff.success) {
        await db
          .update(conversations)
          .set({
            aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));
      }
      return {
        didReply: true,
        decision: "human_only",
        reason: "Problema no carro com modelo e ano; handoff técnico",
        silence: false,
      };
    }

    if (isRevisionServiceIntent(intentProbeText)) {
      const slots = ctx.vehicleSlots ?? {};
      const hasCompleteVehicleData = !!(slots.modelo && slots.ano && slots.km);
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Revisão",
        productName: reservationContext.productName,
      });
      if (!hasCompleteVehicleData) {
        await sendMessage(
          ctx.conversationId,
          "Perfeito! Para revisão, antes de eu agir, preciso dos dados completos do veículo: *modelo, ano e km*."
        );
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Revisão identificada; solicitando modelo, ano e km antes de agir",
          silence: false,
        };
      }

      await sendMessage(
        ctx.conversationId,
        "Perfeito, vou direcionar agora seu atendimento de revisão para um mecânico técnico."
      );
      const handoff = await handoffToHuman(
        ctx.conversationId,
        ctx.organizationId,
        "Cliente solicitou revisão; encaminhado para mecânico técnico"
      );
      if (handoff.success) {
        await db
          .update(conversations)
          .set({
            aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));
      }
      return {
        didReply: true,
        decision: "human_only",
        reason: "Revisão com veículo identificado; handoff técnico 24h",
        silence: false,
      };
    }

    if (shouldAskOilQualification(intentProbeText)) {
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Troca de Óleo",
        productName: reservationContext.productName,
      });
      if (!hasFullVehicleProfile) {
        await sendMessage(
          ctx.conversationId,
          "Perfeito! Para óleo, antes de eu agir, preciso dos dados completos do veículo: *modelo, ano e km*."
        );
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_vehicle");
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Óleo identificado; solicitando modelo, ano e km antes de agir",
          silence: false,
        };
      }
      const oilQualificationReply = hasKnownModelAndYear
        ? knownOilSpec
          ? `Perfeito! Tenho seu veículo como *${knownVehicleLabel}* e o último óleo como *${knownOilSpec}*. Você ainda usa esse óleo? Se não souber o óleo atual, me responda *não sei* que eu já direciono para o mecânico técnico.`
          : "Perfeito! Você sabe qual óleo é utilizado no carro? Se não souber o óleo, me responda *não sei* que eu já direciono para o mecânico técnico."
        : "Perfeito! Você sabe qual óleo é utilizado no carro? Se não souber, pode me informar o *modelo* e o *ano* do veículo.";
      await sendMessage(ctx.conversationId, oilQualificationReply);
      if (hasKnownModelAndYear) {
        await persistOilFlowState(ctx.conversationId, conversationMetadata, {
          awaitingUnknownOilConfirmation: true,
        });
      }
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

    // Guard-rail: enquanto estiver aguardando a necessidade do cliente, não pode
    // avançar para reserva só porque recebeu dados adicionais do veículo (ex: km).
    // Sem uma intenção concreta, reforça a pergunta de descoberta.
    if (
      !looksLikeCatalogIntent(intentProbeText) &&
      !looksLikeCarProblemOrRepairIntent(intentProbeText) &&
      !looksLikeDirectHumanMechanicalIssue(intentProbeText)
    ) {
      const needPrompt = buildNeedDiscoveryPrompt(intentProbeText);
      const followUpNeed = looksLikeReservationIntent(intentProbeText)
        ? `Perfeito, agora que tenho os dados necessários. ${needPrompt}`
        : `Perfeito, agora que tenho os dados necessários, ${needPrompt.toLowerCase()}`;
      const suppressRepeatNeedPrompt = await shouldSuppressRepeatedNeedPrompt(
        ctx.conversationId,
        followUpNeed
      );
      if (suppressRepeatNeedPrompt) {
        return {
          didReply: false,
          decision: "tool_then_ai",
          reason: "Pergunta de dúvida repetida recentemente; suprimindo duplicação",
          silence: true,
        };
      }
      await sendMessage(ctx.conversationId, followUpNeed);
      await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_need");
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "intake_reask_need",
        decision: "tool_then_ai",
        reason: "Mensagem sem intenção concreta durante descoberta da necessidade",
        traceId: params.traceId,
        stage: "orchestrator.intake",
        decisionCode: "INTAKE_REASK_NEED",
        durationMs: Date.now() - startedAt,
        metadata: {
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Reforçando pergunta da dúvida antes de avançar no fluxo",
        silence: false,
      };
    }

    if (!isGenericBudgetRequest(intentProbeText)) {
      // Cliente já descreveu o problema; deixa a busca do catálogo seguir.
    } else {
    const followUp = "Certo. Qual seria o seu problema?";
    await sendMessage(ctx.conversationId, followUp);
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
    !looksLikeReservationIntent(intentProbeText) &&
    !containsDateOrTimeHint(intentProbeText) &&
    !looksLikeReservationConfirmation(ctx.messageContent)
  ) {
    if (intakeStage === "awaiting_issue" && isRevisionServiceIntent(intentProbeText)) {
      const slots = ctx.vehicleSlots ?? {};
      const hasModelAndYear = !!(slots.modelo && slots.ano);
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Revisão",
        productName: reservationContext.productName,
      });

      if (!hasModelAndYear) {
        await sendMessage(
          ctx.conversationId,
          "Perfeito! Para revisão, me informe o *modelo* e o *ano* do veículo. Se souber, me passe também o *km* para deixar o diagnóstico inicial mais preciso."
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Revisão em triagem; solicitando veículo antes do handoff",
          silence: false,
        };
      }

      await sendMessage(
        ctx.conversationId,
        "Perfeito, vou direcionar agora seu atendimento de revisão para um mecânico técnico."
      );
      const handoff = await handoffToHuman(
        ctx.conversationId,
        ctx.organizationId,
        "Cliente confirmou revisão; encaminhado para mecânico técnico"
      );
      if (handoff.success) {
        await db
          .update(conversations)
          .set({
            aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId));
      }
      return {
        didReply: true,
        decision: "human_only",
        reason: "Revisão confirmada; handoff técnico e pausa IA 24h",
        silence: false,
      };
    }

    const issueVehicleSlots = extractVehicleSlotsFromText(ctx.messageContent);
    const hasModelOrYearInIssueMessage = !!(issueVehicleSlots.modelo || issueVehicleSlots.ano);
    const serviceLooksLikeOil =
      normalizeForSearch(reservationContext.serviceName ?? "").includes("oleo") ||
      normalizeForSearch(ctx.messageContent).includes("oleo");
    const hasOilSpecInMessage = !!extractOilSpec(ctx.messageContent);
    if (
      intakeStage === "awaiting_issue" &&
      serviceLooksLikeOil &&
      hasModelOrYearInIssueMessage &&
      !hasOilSpecInMessage
    ) {
      await sendMessage(
        ctx.conversationId,
        "Entendi. Você sabe o tipo do óleo?\nSe conseguir, me passe também a *quilometragem (km)* do veículo, porque isso deixa o orçamento mais preciso. Se não souber, tudo bem que eu continuo o atendimento."
      );
      await persistOilFlowState(ctx.conversationId, conversationMetadata, {
        awaitingUnknownOilConfirmation: true,
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Confirmação de óleo desconhecido antes do handoff",
        silence: false,
      };
    }

    if (looksLikeUnknownOilMessage(ctx.messageContent)) {
      const slots = ctx.vehicleSlots ?? {};
      const hasModelAndYear = !!(slots.modelo && slots.ano);
      if (hasModelAndYear) {
        await sendMessage(
          ctx.conversationId,
          "Perfeito, sem problema. Vou encaminhar para um mecânico técnico continuar seu atendimento e confirmar a especificação correta para o seu veículo."
        );
        const handoff = await handoffToHuman(
          ctx.conversationId,
          ctx.organizationId,
          "Cliente não sabe especificação do óleo; encaminhado para mecânico técnico"
        );
        if (handoff.success) {
          await db
            .update(conversations)
            .set({
              aiDisabledUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
              updatedAt: new Date(),
            })
            .where(eq(conversations.id, ctx.conversationId));
        }
        await logOrchestration({
          conversationId: ctx.conversationId,
          organizationId: ctx.organizationId,
          event: "catalog_handoff_technical_oil_unknown",
          decision: "human_only",
          reason: "Cliente sem informação do óleo; handoff técnico por 24h",
          traceId: params.traceId,
          stage: "orchestrator.catalog",
          decisionCode: "CATALOG_HANDOFF_TECHNICAL_24H",
          durationMs: Date.now() - startedAt,
          metadata: {
            hasModelAndYear,
            handoffSuccess: handoff.success,
            vehicleSlots: slots,
            messageContent: ctx.messageContent,
          },
        });
        return {
          didReply: true,
          decision: "human_only",
          reason: "Encaminhado para mecânico técnico e IA pausada por 24h",
          silence: false,
        };
      }

      await sendMessage(
        ctx.conversationId,
        "Sem problema. Para eu encaminhar certinho ao mecânico técnico, me informe o *modelo* e o *ano* do veículo."
      );
      if (intakeStage !== "awaiting_issue") {
        await persistIntakeStage(ctx.conversationId, conversationMetadata, "awaiting_issue");
      }
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Cliente não sabe óleo; solicitando modelo e ano para handoff",
        silence: false,
      };
    }

    if (shouldAskOilQualification(ctx.messageContent)) {
      const oilQualificationReply = hasKnownModelAndYear
        ? knownOilSpec
          ? `Pra te indicar o valor correto, tenho seu veículo como *${knownVehicleLabel}* e o último óleo como *${knownOilSpec}*. Você ainda usa esse óleo? Se não souber o óleo atual, me responda *não sei* que eu já direciono para o mecânico técnico.`
          : "Pra te indicar o valor correto, você sabe qual óleo é utilizado no carro? Se não souber o óleo, me responda *não sei* que eu já direciono para o mecânico técnico."
        : "Pra te indicar o valor correto da troca, você sabe qual óleo é utilizado no carro? Se não souber, me informe o *modelo* e o *ano* do veículo.";
      await sendMessage(ctx.conversationId, oilQualificationReply);
      await persistReservationContext(ctx.conversationId, conversationMetadata, {
        serviceName: "Troca de Óleo",
        productName: reservationContext.productName,
      });
      if (hasKnownModelAndYear) {
        await persistOilFlowState(ctx.conversationId, conversationMetadata, {
          awaitingUnknownOilConfirmation: true,
        });
      }
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
    const shouldAppendKnownOilSpec =
      !!knownOilSpec &&
      normalizeForSearch(reservationContext.serviceName ?? "").includes("oleo") &&
      !extractOilSpec(catalogQuery);
    const enrichedCatalogQuery = shouldAppendKnownOilSpec
      ? `${catalogQuery} ${knownOilSpec}`
      : catalogQuery;
    const catalog = await buildCatalogReply(ctx.organizationId, enrichedCatalogQuery, {
      skipIntentCheck: intakeStage === "awaiting_issue" || intakeStage === "awaiting_need",
    });
    if (catalog) {
      const oilCatalogContext =
        normalizeForSearch(catalog.selectedServiceName ?? "").includes("oleo") ||
        normalizeForSearch(catalog.selectedProductName ?? "").includes("oleo") ||
        normalizeForSearch(reservationContext.serviceName ?? "").includes("oleo") ||
        isOilExchangeIntent(ctx.messageContent);
      const finalCatalogReply = oilCatalogContext
        ? `${catalog.reply}\n\n${buildVehicleFollowUpForOilQuote(ctx.vehicleSlots)}`
        : catalog.reply;

      await sendMessage(ctx.conversationId, finalCatalogReply);
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
      await sendMessage(
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
      await sendMessage(ctx.conversationId, fallbackReservation);
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
      await sendMessage(
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

  // Fluxo de reserva para restaurante: nome → data → horário → pessoas → confirmação
  if (
    ctx.reservationsEnabled &&
    ctx.botConfig?.segment === "restaurante" &&
    (looksLikeReservationIntent(intentProbeText) || looksLikeRestaurantReservationIntent(intentProbeText))
  ) {
    const nowRef = new Date();
    const reservationWindow = {
      start: ctx.reservationSchedule?.start ?? "09:00",
      end: ctx.reservationSchedule?.end ?? "17:00",
    };
    const reservationWindowLabel = `${reservationWindow.start} às ${reservationWindow.end}`;
    const rf = getRestaurantReservationFlow(conversationMetadata);
    const periodSelection = getReservationPeriodSelection(conversationMetadata);
    const parsedDateOnly = extractReservationDateOnly(ctx.messageContent, nowRef);
    const parsedDateTime = extractReservationDateTime(ctx.messageContent, nowRef);
    const timeOnly = extractTime(ctx.messageContent);
    const informedPeriod = detectReservationPeriod(ctx.messageContent);
    const peopleCount = extractPeopleCount(ctx.messageContent);

    if (!contactName && (!rf || rf.collectionStage === "collect_name")) {
      await sendMessage(
        ctx.conversationId,
        "Para reservar uma mesa, primeiro me diga seu *nome*, por favor."
      );
      await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, {
        collectionStage: "collect_name",
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: solicitando nome para reserva",
        silence: false,
      };
    }

    if (
      contactName &&
      (!rf || rf.collectionStage === "collect_date") &&
      !parsedDateOnly &&
      !parsedDateTime
    ) {
      await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, {
        collectionStage: "collect_date",
      });
      await sendMessage(
        ctx.conversationId,
        `Perfeito, *${contactName}*. Para qual data você gostaria de reservar? (ex: amanhã ou 15/03). Atendemos das *${reservationWindowLabel}*.`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: solicitando data",
        silence: false,
      };
    }

    if (
      contactName &&
      (!rf || rf.collectionStage === "collect_date") &&
      parsedDateTime
    ) {
      if (!isDateAllowedForReservation(parsedDateTime.dateStr, ctx.reservationSchedule)) {
        await sendMessage(
          ctx.conversationId,
          `Nessa data não temos atendimento. Me diga outro dia. Atendemos das *${reservationWindowLabel}*.`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Restaurante: data indisponível",
          silence: false,
        };
      }
      const timeStr = parsedDateTime.timeStr;
      if (!isReservationTimeAllowed(timeStr, reservationWindow)) {
        await sendMessage(
          ctx.conversationId,
          `Consigo reservar apenas entre *${reservationWindowLabel}*. Qual horário você prefere?`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Restaurante: horário fora da janela",
          silence: false,
        };
      }
      const availability = await checkAvailabilityForOrg(
        ctx.organizationId,
        parsedDateTime.dateStr,
        timeStr,
        90
      );
      if (!availability.available) {
        await sendMessage(
          ctx.conversationId,
          "Esse horário não está disponível. Me diga outro dia e horário."
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Restaurante: horário indisponível",
          silence: false,
        };
      }
      await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, {
        dateStr: parsedDateTime.dateStr,
        timeStr,
        collectionStage: "collect_people",
      });
      await sendMessage(
        ctx.conversationId,
        "Horário disponível. Para quantas pessoas será a reserva?"
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: data+horário recebidos, solicitando pessoas",
        silence: false,
      };
    }

    if (
      contactName &&
      (!rf || rf.collectionStage === "collect_date") &&
      parsedDateOnly &&
      !parsedDateTime
    ) {
      if (!isDateAllowedForReservation(parsedDateOnly.dateStr, ctx.reservationSchedule)) {
        await sendMessage(
          ctx.conversationId,
          `Nessa data não temos atendimento. Me diga outro dia (ex: amanhã ou 15/03). Atendemos das *${reservationWindowLabel}*.`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Restaurante: data indisponível",
          silence: false,
        };
      }
      await persistReservationPeriodSelection(
        ctx.conversationId,
        conversationMetadata,
        { dateStr: parsedDateOnly.dateStr }
      );
      await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, {
        dateStr: parsedDateOnly.dateStr,
        collectionStage: "collect_datetime",
      });
      const friendlyDate = formatDateForPtBr(parsedDateOnly.dateStr);
      await sendMessage(
        ctx.conversationId,
        `Perfeito, *${contactName}*. Para *${friendlyDate}*, você prefere *manhã* ou *tarde*? Atendemos das *${reservationWindowLabel}*.`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: solicitando período",
        silence: false,
      };
    }

    if (
      rf?.dateStr &&
      (periodSelection?.dateStr ?? rf.dateStr) &&
      informedPeriod &&
      !rf.timeStr
    ) {
      const dateStr = rf.dateStr;
      const slots = await findAvailableSlotsForPeriod(
        ctx.organizationId,
        dateStr,
        informedPeriod,
        nowRef,
        reservationWindow
      );
      const friendlyDate = formatDateForPtBr(dateStr);
      if (slots.length === 0) {
        await sendMessage(
          ctx.conversationId,
          `No período da ${informedPeriod === "morning" ? "manhã" : "tarde"} de *${friendlyDate}* não há horários livres. Quer tentar o outro período?`
        );
      } else {
        await sendMessage(
          ctx.conversationId,
          `Para *${friendlyDate}* no período da ${informedPeriod === "morning" ? "manhã" : "tarde"}, tenho: *${slots.join(", ")}*. Qual horário você prefere?`
        );
      }
      await persistReservationPeriodSelection(
        ctx.conversationId,
        conversationMetadata,
        { dateStr, period: informedPeriod }
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: horários sugeridos",
        silence: false,
      };
    }

    if (
      rf?.dateStr &&
      !rf.timeStr &&
      timeOnly &&
      !parsedDateTime
    ) {
      const timeStr = toTimeStr(timeOnly.hour, timeOnly.minute);
      if (!isReservationTimeAllowed(timeStr, reservationWindow)) {
        await sendMessage(
          ctx.conversationId,
          `Consigo reservar apenas entre *${reservationWindowLabel}*. Qual horário você prefere?`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Restaurante: horário fora da janela",
          silence: false,
        };
      }
      const availability = await checkAvailabilityForOrg(
        ctx.organizationId,
        rf.dateStr,
        timeStr,
        90
      );
      if (!availability.available) {
        await sendMessage(
          ctx.conversationId,
          "Esse horário não está disponível. Me diga outro horário que eu consulto."
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Restaurante: horário indisponível",
          silence: false,
        };
      }
      await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, {
        dateStr: rf.dateStr,
        timeStr,
        collectionStage: "collect_people",
      });
      await sendMessage(
        ctx.conversationId,
        "Horário disponível. Para quantas pessoas será a reserva?"
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: solicitando quantidade de pessoas",
        silence: false,
      };
    }

    if (
      rf?.dateStr &&
      rf?.timeStr &&
      rf.collectionStage === "collect_people" &&
      !peopleCount &&
      !looksLikeReservationConfirmation(ctx.messageContent)
    ) {
      await sendMessage(
        ctx.conversationId,
        "Para quantas pessoas será a reserva? (ex: 2, 4 pessoas)"
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: resposta inválida para quantidade de pessoas",
        silence: false,
      };
    }

    if (rf?.dateStr && rf?.timeStr && !rf.peopleCount && peopleCount) {
      await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, {
        dateStr: rf.dateStr,
        timeStr: rf.timeStr,
        peopleCount,
        collectionStage: "confirm_reservation",
      });
      await savePendingReservation(ctx.conversationId, conversationMetadata, {
        dateStr: rf.dateStr,
        timeStr: rf.timeStr,
        durationMinutes: 90,
      });
      const friendlyDate = formatDateForPtBr(rf.dateStr);
      await sendMessage(
        ctx.conversationId,
        `Perfeito. Reserva para *${peopleCount}* pessoa(s) em *${friendlyDate}* às *${rf.timeStr}*. Responda *sim* para confirmar.`
      );
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Restaurante: aguardando confirmação",
        silence: false,
      };
    }
  }

  if (ctx.reservationsEnabled && ctx.usesVehicleSlots && !ctx.pendingReservation) {
    const nowRef = new Date();
    const reservationWindow = {
      start: ctx.reservationSchedule?.start ?? "09:00",
      end: ctx.reservationSchedule?.end ?? "17:00",
    };
    const reservationWindowLabel = `${reservationWindow.start} às ${reservationWindow.end}`;
    const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
    const missingName = !contactName;
    const periodSelection = getReservationPeriodSelection(conversationMetadata);
    const parsedDateOnly = extractReservationDateOnly(ctx.messageContent, nowRef);
    const parsedDateTime = extractReservationDateTime(ctx.messageContent, nowRef);
    const timeOnly = extractTime(ctx.messageContent);
    const informedPeriod = detectReservationPeriod(ctx.messageContent);

    if (
      parsedDateOnly &&
      !missingName &&
      missingVehicle.length === 0
    ) {
      if (!isDateAllowedForReservation(parsedDateOnly.dateStr, ctx.reservationSchedule)) {
        await sendMessage(
          ctx.conversationId,
          `Nessa data não temos atendimento disponível. Me diga outro dia dentro da nossa agenda (${reservationWindowLabel}) para eu te ajudar.`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Data informada fora dos dias disponíveis",
          silence: false,
        };
      }
      await persistReservationPeriodSelection(
        ctx.conversationId,
        conversationMetadata,
        { dateStr: parsedDateOnly.dateStr }
      );
      const friendlyDate = formatDateForPtBr(parsedDateOnly.dateStr);
      await sendMessage(
        ctx.conversationId,
        `Perfeito, para *${friendlyDate}*. Você prefere *manhã* ou *tarde*? Atendemos das *${reservationWindowLabel}*.`
      );
      await persistReservationFlowMetadata(ctx.conversationId, conversationMetadata, {
        collectionStage: "collect_datetime",
        slotConfidence: buildSlotConfidenceMap(contactName, ctx.vehicleSlots ?? {}),
      });
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_collect_period",
        decision: "tool_then_ai",
        reason: "Cliente informou data sem horário; solicitando período",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_COLLECT_PERIOD",
        durationMs: Date.now() - startedAt,
        metadata: {
          dateStr: parsedDateOnly.dateStr,
          messageContent: ctx.messageContent,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Solicitou período após receber data sem horário",
        silence: false,
      };
    }

    if (
      periodSelection?.dateStr &&
      informedPeriod &&
      !missingName &&
      missingVehicle.length === 0
    ) {
      const slots = await findAvailableSlotsForPeriod(
        ctx.organizationId,
        periodSelection.dateStr,
        informedPeriod,
        nowRef,
        reservationWindow
      );
      const friendlyDate = formatDateForPtBr(periodSelection.dateStr);
      if (slots.length === 0) {
        await sendMessage(
          ctx.conversationId,
          `No período da ${informedPeriod === "morning" ? "manhã" : "tarde"} de *${friendlyDate}* não encontrei horários livres dentro da nossa agenda (${reservationWindowLabel}). Quer tentar o outro período?`
        );
      } else {
        await sendMessage(
          ctx.conversationId,
          `Perfeito. Para *${friendlyDate}* no período da ${informedPeriod === "morning" ? "manhã" : "tarde"}, tenho: *${slots.join(", ")}*. Qual horário você prefere?`
        );
      }
      await persistReservationPeriodSelection(
        ctx.conversationId,
        conversationMetadata,
        { dateStr: periodSelection.dateStr, period: informedPeriod }
      );
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_suggest_period_slots",
        decision: "tool_then_ai",
        reason: "Período informado; sugerindo horários disponíveis no intervalo comercial",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_SUGGEST_PERIOD_SLOTS",
        durationMs: Date.now() - startedAt,
        metadata: {
          dateStr: periodSelection.dateStr,
          period: informedPeriod,
          slots,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Horários sugeridos por período",
        silence: false,
      };
    }

    if (
      periodSelection?.dateStr &&
      timeOnly &&
      !parsedDateTime &&
      !missingName &&
      missingVehicle.length === 0
    ) {
      const timeStr = toTimeStr(timeOnly.hour, timeOnly.minute);
      if (!isReservationTimeAllowed(timeStr, reservationWindow)) {
        await sendMessage(
          ctx.conversationId,
          `Consigo reservar apenas entre *${reservationWindowLabel}*. Me diga um horário dentro desse intervalo, por favor.`
        );
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Horário fora da janela comercial",
          silence: false,
        };
      }
      const availability = await checkAvailabilityForOrg(
        ctx.organizationId,
        periodSelection.dateStr,
        timeStr,
        60
      );
      const parsedWithContext = {
        dateStr: periodSelection.dateStr,
        timeStr,
      };
      await sendMessage(
        ctx.conversationId,
        buildAvailabilityReply(parsedWithContext, availability.available)
      );
      await savePendingReservation(
        ctx.conversationId,
        conversationMetadata,
        availability.available
          ? {
              dateStr: parsedWithContext.dateStr,
              timeStr: parsedWithContext.timeStr,
              durationMinutes: 60,
            }
          : null
      );
      if (availability.available) {
        await persistReservationPeriodSelection(
          ctx.conversationId,
          conversationMetadata,
          null
        );
      }
      await logOrchestration({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        event: "reservation_time_with_context",
        decision: "tool_then_ai",
        reason: "Horário recebido sem data; aplicando data previamente informada",
        traceId: params.traceId,
        stage: "orchestrator.reservations",
        decisionCode: "RESERVATION_TIME_WITH_CONTEXT",
        durationMs: Date.now() - startedAt,
        metadata: {
          dateStr: parsedWithContext.dateStr,
          timeStr: parsedWithContext.timeStr,
          available: availability.available,
        },
      });
      return {
        didReply: true,
        decision: "tool_then_ai",
        reason: "Disponibilidade consultada com data de contexto",
        silence: false,
      };
    }
  }

  // Se já existe horário pendente de confirmação e cliente confirmou, cria a reserva.
  if (ctx.reservationsEnabled && ctx.pendingReservation) {
    const pending = ctx.pendingReservation;
    const missingVehicle = ctx.usesVehicleSlots
      ? getMissingSlots(ctx.vehicleSlots ?? {})
      : [];
    const missingName = !contactName;
    const missingRestaurantPeople =
      ctx.botConfig?.segment === "restaurante" &&
      !getRestaurantReservationFlow(conversationMetadata)?.peopleCount &&
      !missingName;

    if (!looksLikeReservationConfirmation(ctx.messageContent)) {
      if (missingRestaurantPeople) {
        await sendMessage(
          ctx.conversationId,
          "Para quantas pessoas será a reserva?"
        );
        await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, {
          collectionStage: "collect_people",
        });
        return {
          didReply: true,
          decision: "tool_then_ai",
          reason: "Restaurante: solicitando quantidade de pessoas",
          silence: false,
        };
      }
      if (missingName || missingVehicle.length > 0) {
        const promptKey = buildProfilePromptKey(missingName, missingVehicle);
        const promptState = getPromptRepeatState(conversationMetadata, promptKey);
        await sendMessage(
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

      await sendMessage(
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
      await sendMessage(
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
      await sendMessage(
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
    const restaurantPeople =
      ctx.botConfig?.segment === "restaurante"
        ? getRestaurantReservationFlow(conversationMetadata)?.peopleCount ?? null
        : null;
    const reservationNotes = JSON.stringify({
      customerName: contactName,
      vehicle: ctx.usesVehicleSlots
        ? {
            modelo: ctx.vehicleSlots?.modelo ?? null,
            ano: ctx.vehicleSlots?.ano ?? null,
            km: ctx.vehicleSlots?.km ?? null,
          }
        : null,
      peopleCount: restaurantPeople,
      serviceName: reservationContext.serviceName,
      productName: reservationContext.productName,
    });
    const created = await createReservationForOrg(ctx.organizationId, {
      startAt,
      durationMinutes: pending.durationMinutes,
      contactId: ctx.contactId,
      serviceName:
        ctx.botConfig?.segment === "restaurante"
          ? "Reserva de mesa"
          : (reservationContext.serviceName ?? undefined),
      productName: reservationContext.productName ?? undefined,
      notes: reservationNotes,
      source: "ai",
    });
    await savePendingReservation(ctx.conversationId, conversationMetadata, null);
    await persistReservationContext(ctx.conversationId, conversationMetadata, null);
    if (ctx.botConfig?.segment === "restaurante") {
      await persistRestaurantReservationFlow(ctx.conversationId, conversationMetadata, null);
    }

    if (created?.success) {
      const friendlyDate = formatDateForPtBr(pending.dateStr);
      const peopleLabel =
        ctx.botConfig?.segment === "restaurante" && restaurantPeople
          ? ` para ${restaurantPeople} pessoa(s)`
          : "";
      await sendMessage(
        ctx.conversationId,
        `Perfeito. Reserva confirmada para ${friendlyDate} às ${pending.timeStr}${peopleLabel}.`
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
        await sendMessage(
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

      await sendMessage(ctx.conversationId, reply);
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
      if (availability.available) {
        await persistReservationPeriodSelection(
          ctx.conversationId,
          conversationMetadata,
          null
        );
      }
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
        await sendMessage(
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
      await sendMessage(ctx.conversationId, reply);
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
        await sendMessage(
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

      await sendMessage(ctx.conversationId, reply);
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
      if (availability.available) {
        await persistReservationPeriodSelection(
          ctx.conversationId,
          conversationMetadata,
          null
        );
      }
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
      await sendMessage(ctx.conversationId, reply);
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
      await sendMessage(
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
      await sendMessage(ctx.conversationId, reply);
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
        await sendMessage(
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
      await sendMessage(ctx.conversationId, reply);
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
      if (availability.available) {
        await persistReservationPeriodSelection(
          ctx.conversationId,
          conversationMetadata,
          null
        );
      }
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

    await sendMessage(
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
    await sendMessage(
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

  // FAQ: responder direto se houver entrada com confidence >= 80 (camada antes da IA)
  const faq = await findRelevantFAQ(ctx.organizationId, ctx.messageContent, 80);
  if (faq) {
    await sendMessage(ctx.conversationId, faq.answer);
    await incrementFaqUsage(faq.id);
    await setLastUsedFaqId(ctx.conversationId, faq.id);
    await clearLastUsedExampleIds(ctx.conversationId);
    await logOrchestration({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      event: "faq_responded",
      decision: "ai_respond",
      reason: "Resposta via FAQ (base de conhecimento)",
      traceId: params.traceId,
      stage: "orchestrator.faq",
      decisionCode: "FAQ_RESPONSE",
      metadata: { faqId: faq.id },
    });
    return {
      didReply: true,
      decision: result.decision,
      reason: result.reason,
      silence: false,
    };
  }

  const aiReplied = await callAIWithContext(ctx, sendMessage, {
    traceId: params.traceId,
  });
  return {
    didReply: aiReplied,
    decision: result.decision,
    reason: result.reason,
    silence: false,
  };
}
