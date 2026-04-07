/**
 * Slot filling - extração de dados estruturados das mensagens.
 * Usado para acumular modelo e ano do veículo sem depender do LLM.
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
  "olhada",
  "olhar",
  "atendimento",
  "agenda",
  "agendamento",
  "agendar",
  "problema",
  "duvida",
  "dúvida",
  "servico",
  "serviço",
  "troca",
  "oleo",
  "óleo",
  "orcamento",
  "orçamento",
  "revisao",
  "revisão",
  "levar",
  "trazer",
  "consigo",
  "consegue",
  "quero",
  "queria",
  "gostaria",
  "posso",
  "pode",
  ]);

const ALLOWED_SHORT_MODELS = new Set([
  "gol",
  "uno",
  "up",
  "fit",
  "c3",
  "c4",
]);

const INVALID_MODELO_PHRASES = [
  "me chamo",
  "meu nome",
  "sou o",
  "sou a",
  "gostaria",
  "quero",
  "preciso",
  "orcamento",
  "orçamento",
  "troca",
  "trocar",
  "oleo",
  "óleo",
  "servico",
  "serviço",
  "agendar",
  "agendamento",
  "dar uma olhada",
  "da uma olhada",
  "dá uma olhada",
  "dar olhada",
  "pra dar uma olhada",
  "para dar uma olhada",
  "meu carro",
  "do meu carro",
  "levar",
  "trazer",
  "consigo levar",
  "quero levar",
  "queria levar",
  "gostaria de levar",
  "posso levar",
  "pra levar",
  "para levar",
];

const VEHICLE_NOISE_WORDS = new Set([
  "me",
  "chamo",
  "nome",
  "sou",
  "meu",
  "minha",
  "carro",
  "veiculo",
  "veículo",
  "modelo",
  "ano",
  "km",
  "quilometragem",
  "eh",
  "e",
  "é",
  "um",
  "uma",
  "o",
  "a",
  "com",
  "de",
  "do",
  "da",
  "no",
  "na",
  "ta",
  "tá",
  "esta",
  "está",
  "tenho",
  "to",
  "tô",
  "consigo",
  "consegue",
  "conseguimos",
  "quero",
  "queria",
  "gostaria",
  "posso",
  "pode",
  "levar",
  "trazer",
  "pra",
  "para",
]);

const KNOWN_BRAND_ALIASES: Record<string, string> = {
  vw: "Volkswagen",
  volks: "Volkswagen",
  volkswagen: "Volkswagen",
  gm: "Chevrolet",
  chevrolet: "Chevrolet",
  fiat: "Fiat",
  ford: "Ford",
  toyota: "Toyota",
  honda: "Honda",
  hyundai: "Hyundai",
  renault: "Renault",
  peugeot: "Peugeot",
  citroen: "Citroen",
  nissan: "Nissan",
  jeep: "Jeep",
  mitsubishi: "Mitsubishi",
  kia: "Kia",
  bmw: "BMW",
  audi: "Audi",
  mercedes: "Mercedes",
  mercedesbenz: "Mercedes",
};

function normalizeModel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDisplayToken(token: string): string {
  if (/^(?:[0-9]+(?:\.[0-9]+)?)$/.test(token)) return token;
  if (/^(tsi|gdi|mpi|tfsi|cvt|mt|at)$/i.test(token)) return token.toUpperCase();
  if (/^[a-z]{1,3}[0-9]{1,4}$/i.test(token)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function canonicalizeVehicleModel(value: string): string {
  const normalized = normalizeModel(value);
  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !VEHICLE_NOISE_WORDS.has(t))
    .filter((t) => !/^(19[89]\d|20[0-3]\d)$/.test(t))
    .filter((t) => !/^\d{1,6}$/.test(t));

  if (tokens.length === 0) return "";

  const first = tokens[0]!;
  const canonicalBrand = KNOWN_BRAND_ALIASES[first];
  if (canonicalBrand) {
    const rest = tokens.slice(1).map(toDisplayToken);
    return [canonicalBrand, ...rest].join(" ").trim();
  }

  return tokens.map(toDisplayToken).join(" ").trim();
}

export function isValidVehicleModel(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const normalized = normalizeModel(value);
  if (
    normalized.length <= 3 &&
    !ALLOWED_SHORT_MODELS.has(normalized) &&
    !/^[a-z]+\d{1,2}$/i.test(normalized)
  ) {
    return false;
  }
  if (normalized.split(/\s+/).filter(Boolean).length > 4) return false;
  if (/^(?:e|eh)\s+/.test(normalized)) return false;
  if (INVALID_MODELO_TERMS.has(normalized)) return false;
  if (INVALID_MODELO_PHRASES.some((term) => normalized.includes(term))) return false;
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
  const hasOwnershipHint =
    /\b(?:tenho|estou\s+com|est[áa]\s+com|to\s+com|t[oô]\s+com|uso|dirijo)\s+(?:um|uma|o|a)?\s*[a-záàâãéêíóôõúç0-9-]{2,30}\b/i.test(
      trimmed
    );
  // Sem pista de veículo (ano/km/keyword), não inferir modelo para evitar falso positivo.
  if (!ano && !km && !hasVehicleHint && !hasOwnershipHint) {
    return undefined;
  }
  let candidate: string | undefined;

  // Frases comuns: "tenho um onix 2022", "estou com um gol 2018", etc.
  if (!candidate && ano) {
    const ownershipBeforeYear = trimmed.match(
      new RegExp(
        String.raw`\b(?:tenho|estou\s+com|est[áa]\s+com|to\s+com|t[oô]\s+com|uso|dirijo)\s+(?:um|uma|o|a)?\s*([a-záàâãéêíóôõúç0-9\s-]{2,40})\s+${ano}\b`,
        "i"
      )
    );
    if (ownershipBeforeYear && !/^\d+$/.test(ownershipBeforeYear[1].trim())) {
      candidate = ownershipBeforeYear[1].trim();
    }
  }

  // Variante sem ano explícito próximo: "tenho um onix com 80mil km"
  if (!candidate) {
    const ownershipModel = trimmed.match(
      /\b(?:tenho|estou\s+com|est[áa]\s+com|to\s+com|t[oô]\s+com|uso|dirijo)\s+(?:um|uma|o|a)?\s*([a-záàâãéêíóôõúç0-9\s-]{2,30})(?=\s+(?:com|ano|km|quilometragem|pra|para)\b|[,.!?;]|$)/i
    );
    if (ownershipModel && !/^\d+$/.test(ownershipModel[1].trim())) {
      candidate = ownershipModel[1].trim();
    }
  }

  // Fallback robusto: captura até 3 tokens imediatamente antes do ano.
  // Ex.: "onix 2022", "new fiesta 2018", "gol g5 2010"
  if (!candidate && ano) {
    const nearYear = trimmed.match(
      new RegExp(
        String.raw`([a-záàâãéêíóôõúç0-9-]{2,20}(?:\s+[a-záàâãéêíóôõúç0-9-]{1,20}){0,2})\s+${ano}\b`,
        "i"
      )
    );
    if (nearYear && !/^\d+$/.test(nearYear[1].trim())) {
      candidate = nearYear[1].trim();
    }
  }

  // Fallback amplo: trecho anterior ao ano, mas reduzido para os últimos 3 tokens
  // para evitar salvar frases longas como modelo.
  const beforeYear = ano
    ? trimmed.match(new RegExp(`(.+?)\\s+${ano}\\b`, "i"))
    : null;
  if (!candidate && beforeYear) {
    const beforeYearTokens = beforeYear[1]
      .replace(/\b(é|um|uma|o|a)\s+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const shortened = beforeYearTokens.slice(-3).join(" ").trim();
    if (shortened && !/^\d+$/.test(shortened)) {
      candidate = shortened;
    }
  }

  if (!candidate && hasVehicleHint) {
    const explicitModelo = trimmed.match(
      /\bmodelo(?:\s+do\s+ve[ií]culo)?\s*[:\-]?\s*([a-záàâãéêíóôõúç0-9\s-]{2,40})/i
    );
    if (explicitModelo && !/^\d+$/.test(explicitModelo[1].trim())) {
      candidate = explicitModelo[1].trim();
    } else {
      const explicitVehicleIs = trimmed.match(
        /\b(?:carro|ve[ií]culo)\s*(?:é|eh)\s*(?:um|uma)?\s*([a-záàâãéêíóôõúç0-9\s-]{2,40})/i
      );
      if (explicitVehicleIs && !/^\d+$/.test(explicitVehicleIs[1].trim())) {
        candidate = explicitVehicleIs[1].trim();
      }
    }
  }

  if (candidate) {
    candidate = candidate
      .replace(/\b\d{1,2}\s*w\s*\d{2}\b/gi, " ")
      .replace(/\b(?:me\s+chamo|meu\s+nome(?:\s+e|é)?|sou\s+(?:o|a))\s+[a-záàâãéêíóôõúç']+(?:\s+[a-záàâãéêíóôõúç']+)?/gi, " ")
      // Prefixos comuns de fala que "sujam" o modelo.
      .replace(/^(?:meu\s+)?carro\s+(?:e|é|eh)\s+/, "")
      .replace(/^ve[ií]culo\s+(?:e|é|eh)\s+/, "")
      .replace(/^(?:tenho|estou\s+com|est[áa]\s+com|to\s+com|t[oô]\s+com)\s+/, "")
      .replace(/^(?:consigo|consegue|conseguimos|quero|queria|gostaria|posso|pode)\s+/, "")
      .replace(/^(?:levar|trazer)\s+/, "")
      .replace(/^(?:e|é|eh)\s+/, "")
      .replace(/^(?:um|uma|o|a)\s+/, "")
      // Remove ano capturado junto no modelo (ex.: "onix 2022")
      .replace(/\b(19[89]\d|20[0-3]\d)\b/g, " ")
      .replace(/\s*(?:,|\.|;)\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();

    // Segunda passada de limpeza para casos como "é onix" após remoção parcial.
    candidate = candidate
      .replace(/^(?:e|é|eh)\s+/, "")
      .replace(/^(?:um|uma|o|a)\s+/, "")
      .trim();

    const canonical = canonicalizeVehicleModel(candidate);
    if (isValidVehicleModel(canonical) && canonical.length <= 50) return canonical;
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
  const inboundWindow: string[] = [];
  for (const m of messages) {
    if (m.direction !== "inbound" || !m.content?.trim()) continue;
    const current = m.content.trim();
    inboundWindow.push(current);
    if (inboundWindow.length > 3) inboundWindow.shift();

    const extractedSingle = extractVehicleSlotsFromText(current);
    const extractedWindow = extractVehicleSlotsFromText(inboundWindow.join(" "));
    const incoming: Partial<VehicleSlots> = {
      modelo: extractedSingle.modelo ?? extractedWindow.modelo,
      ano: extractedSingle.ano ?? extractedWindow.ano,
      km: extractedSingle.km ?? extractedWindow.km,
    };

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
  return missing;
}

/** Verifica se todos os slots estão preenchidos. */
export function hasAllVehicleSlots(slots: VehicleSlots): boolean {
  return getMissingSlots(slots).length === 0;
}
