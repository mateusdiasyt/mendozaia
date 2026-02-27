/**
 * Slot filling - extração de dados estruturados das mensagens.
 * Usado para acumular modelo, ano e km do veículo sem depender do LLM.
 */

export interface VehicleSlots {
  modelo?: string;
  ano?: number;
  km?: number;
}

const INVALID_MODELO_TERMS = new Set([
  "oi",
  "ola",
  "olá",
  "bom dia",
  "boa tarde",
  "boa noite",
  "amanha",
  "amanhã",
  "hoje",
  "agora",
  "as",
  "às",
  "dia",
]);

function normalizeModel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function isValidVehicleModel(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const normalized = normalizeModel(value);
  if (normalized.length <= 3) return false;
  if (INVALID_MODELO_TERMS.has(normalized)) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (/\b\d{1,2}\s*w\s*\d{2}\b/i.test(normalized)) return false;
  if (/\b(km|mil|quilometragem|amanh[ãa]|hoje|dia|as|horario)\b/i.test(value)) {
    return false;
  }
  return true;
}

/** Extrai ano de veículo (1980-2035). */
function extractYear(text: string): number | undefined {
  const match = text.match(/\b(19[89]\d|20[0-3]\d)\b/);
  if (!match) return undefined;
  const n = parseInt(match[1], 10);
  return n >= 1980 && n <= 2035 ? n : undefined;
}

/** Extrai quilometragem. Ex: "90 mil km", "230mil", "90.000 km", "150000" */
function extractKm(text: string): number | undefined {
  const lower = text.toLowerCase();
  const milMatch = lower.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*mil(?:\s*km)?/);
  if (milMatch) {
    const num = parseFloat(milMatch[1].replace(/\./g, "").replace(",", "."));
    return isNaN(num) ? undefined : Math.round(num * 1000);
  }
  const kmMatch = text.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:km|quilometragem)/i);
  if (kmMatch) {
    const num = parseFloat(kmMatch[1].replace(/\./g, "").replace(",", "."));
    return isNaN(num) ? undefined : Math.round(num);
  }
  const plainMatch = text.match(/\b(\d{4,6})\b/);
  if (plainMatch) {
    const n = parseInt(plainMatch[1], 10);
    if (n >= 1980 && n <= 2035) return undefined;
    if (n >= 1000 && n <= 999999) return n;
  }
  return undefined;
}

/** Extrai modelo do veículo. Geralmente antes do ano ou em "é um X". */
function extractModelo(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return undefined;

  const ano = extractYear(trimmed);
  const km = extractKm(trimmed);
  const hasVehicleHint = /\b(modelo|ve[ií]culo|carro)\b/i.test(trimmed);
  // Sem pista de veículo (ano/km/keyword), não inferir modelo para evitar falso positivo.
  if (!ano && !km && !hasVehicleHint) {
    return undefined;
  }
  let candidate: string | undefined;

  const beforeYear = ano
    ? trimmed.match(new RegExp(`(.+?)\\s+${ano}\\b`, "i"))
    : null;
  if (beforeYear) {
    candidate = beforeYear[1].replace(/\b(é|um|uma|o|a)\s+/gi, "").trim();
  }

  if (!candidate && hasVehicleHint) {
    const isModelo = trimmed.match(/\b(?:é\s+um?\s+)?([a-záàâãéêíóôõúç0-9\s]{2,40}?)(?:\s+com\s+|\s+-\s+|$)/i);
    if (isModelo && !/^\d+$/.test(isModelo[1].trim())) {
      candidate = isModelo[1].trim();
    }
  }

  if (candidate) {
    candidate = candidate
      .replace(/\b\d{1,2}\s*w\s*\d{2}\b/gi, " ")
      .replace(/\b(?:e|é)?\s*um[a]?\s+/gi, " ")
      .replace(/\s*(?:,|\.|;)\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (isValidVehicleModel(candidate) && candidate.length <= 50) return candidate;
  }
  return undefined;
}

/** Extrai slots de veículo de um texto. */
export function extractVehicleSlotsFromText(text: string): Partial<VehicleSlots> {
  const result: Partial<VehicleSlots> = {};
  if (!text?.trim()) return result;

  const ano = extractYear(text);
  if (ano) result.ano = ano;

  const km = extractKm(text);
  if (km) result.km = km;

  const modelo = extractModelo(text);
  if (modelo) result.modelo = modelo;

  return result;
}

/** Mescla novos slots com existentes. Valores novos sobrescrevem (correção). */
export function mergeVehicleSlots(
  existing: VehicleSlots | undefined,
  incoming: Partial<VehicleSlots>
): VehicleSlots {
  return {
    modelo: incoming.modelo ?? existing?.modelo,
    ano: incoming.ano ?? existing?.ano,
    km: incoming.km ?? existing?.km,
  };
}

/** Processa mensagens em ordem; a última ocorrência de cada slot prevalece (correções). */
export function extractSlotsFromMessages(
  messages: Array<{ direction: string; content: string | null }>
): VehicleSlots {
  let slots: VehicleSlots = {};
  for (const m of messages) {
    if (m.direction !== "inbound" || !m.content?.trim()) continue;
    const extracted = extractVehicleSlotsFromText(m.content);
    const incoming: Partial<VehicleSlots> = { ...extracted };

    // Evita "trocar" modelo já identificado por uma palavra solta (ex.: nome do cliente).
    // A troca continua permitida quando há contexto explícito de veículo.
    if (slots.modelo && incoming.modelo && !incoming.ano && !incoming.km) {
      const trimmed = m.content.trim();
      const isSingleWord = /^[a-zA-ZÀ-ÿ]{2,30}$/.test(trimmed);
      const hasVehicleHint = /\b(modelo|ve[ií]culo|carro)\b/i.test(trimmed);
      if (isSingleWord && !hasVehicleHint) {
        delete incoming.modelo;
      }
    }

    slots = mergeVehicleSlots(slots, incoming);
  }
  return slots;
}

/** Retorna quais slots estão faltando. */
export function getMissingSlots(slots: VehicleSlots): ("modelo" | "ano" | "km")[] {
  const missing: ("modelo" | "ano" | "km")[] = [];
  if (!isValidVehicleModel(slots.modelo)) missing.push("modelo");
  if (!slots.ano) missing.push("ano");
  if (!slots.km) missing.push("km");
  return missing;
}

/** Verifica se todos os slots estão preenchidos. */
export function hasAllVehicleSlots(slots: VehicleSlots): boolean {
  return getMissingSlots(slots).length === 0;
}
