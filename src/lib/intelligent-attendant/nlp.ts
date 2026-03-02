import type { ExtractedEntities, Intent, NlpResult } from "./types";

const WEEK_DAYS = [
  "domingo",
  "segunda",
  "terca",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "sábado",
];

const SERVICE_KEYWORDS: Array<{ key: string; label: string }> = [
  { key: "revis", label: "Revisão" },
  { key: "oleo", label: "Troca de óleo" },
  { key: "óleo", label: "Troca de óleo" },
  { key: "freio", label: "Freio" },
  { key: "alinhamento", label: "Alinhamento" },
  { key: "balanceamento", label: "Balanceamento" },
  { key: "suspensao", label: "Suspensão" },
  { key: "suspensão", label: "Suspensão" },
  { key: "motor", label: "Motor" },
];

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractName(text: string): string | undefined {
  const trimmed = text.trim();

  const explicit = trimmed.match(
    /\b(?:meu nome e|me chamo|sou|aqui e|aqui eh)\s+([A-Za-zÀ-ÿ]{2,}(?:\s+[A-Za-zÀ-ÿ]{2,}){0,2})/i
  );
  if (explicit?.[1]) return explicit[1].trim();

  const shortName = trimmed.match(/^[A-Za-zÀ-ÿ]{2,}(?:\s+[A-Za-zÀ-ÿ]{2,}){0,1}$/);
  if (shortName?.[0]) return shortName[0].trim();

  // Ex.: "Mateus, onix 2022, 80 mil km"
  const firstChunk = trimmed
    .split(/[,.]/)[0]
    ?.replace(/\b(meu nome e|me chamo|sou)\b/gi, "")
    .trim();
  if (
    firstChunk &&
    /^[A-Za-zÀ-ÿ]{2,}(?:\s+[A-Za-zÀ-ÿ]{2,}){0,1}$/.test(firstChunk)
  ) {
    return firstChunk;
  }

  return undefined;
}

function extractVehicleYear(text: string): string | undefined {
  const year = text.match(/\b(19[89]\d|20[0-3]\d)\b/);
  return year?.[1];
}

function extractVehicleModel(text: string): string | undefined {
  const normalized = normalizeText(text);
  const year = extractVehicleYear(text);
  if (year) {
    const beforeYear = text.match(new RegExp(`([A-Za-zÀ-ÿ0-9\\-\\s]{2,40})\\s+${year}\\b`, "i"));
    if (beforeYear?.[1]) {
      const candidate = beforeYear[1]
        .replace(/\b(meu|minha|carro|veiculo|veículo|e|eh|é|um|uma)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (candidate.length >= 2 && !/\b(quero|orcamento|orçamento|agendar)\b/i.test(candidate)) {
        return candidate;
      }
    }
  }

  // Ex.: "2022 onix"
  const afterYear = normalized.match(/\b(19[89]\d|20[0-3]\d)\s+([a-z0-9\- ]{2,30})\b/i);
  if (afterYear?.[2]) {
    const candidate = afterYear[2]
      .replace(/\b(carro|veiculo|veículo|ano|km|mil)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (candidate.length >= 2) return candidate;
  }

  // Ex.: "onix ano 2022"
  const beforeAno = normalized.match(/\b([a-z0-9\- ]{2,30})\s+ano\s+(19[89]\d|20[0-3]\d)\b/i);
  if (beforeAno?.[1]) {
    const candidate = beforeAno[1]
      .replace(/\b(carro|veiculo|veículo|meu|minha)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (candidate.length >= 2) return candidate;
  }

  const explicitModel = text.match(
    /\b(?:modelo|carro|veiculo|veículo)\s*(?:e|eh|é|:)?\s*([A-Za-zÀ-ÿ0-9\- ]{2,40})/i
  );
  if (explicitModel?.[1]) {
    return explicitModel[1].replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function extractMileage(text: string): string | undefined {
  const normalized = normalizeText(text);

  const mil = normalized.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*mil\b/);
  if (mil?.[1]) return `${mil[1].replace(/[.,]/g, "")}000 km`;

  const withKm = normalized.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:km|quilometragem)\b/);
  if (withKm?.[1]) return `${withKm[1].replace(/[.,]/g, "")} km`;

  const withK = normalized.match(/\b(\d{2,3})(?:\s*)k\b/);
  if (withK?.[1]) return `${withK[1]}000 km`;

  const plain = normalized.match(/\b(\d{4,6})\b/);
  if (plain?.[1]) return `${plain[1]} km`;

  return undefined;
}

function extractDesiredDate(text: string): string | undefined {
  const normalized = normalizeText(text);

  if (/\bhoje\b/.test(normalized)) return "hoje";
  if (/\bamanha\b/.test(normalized)) return "amanhã";
  if (/\bproxima semana\b/.test(normalized)) return "próxima semana";
  if (/\bessa semana\b/.test(normalized)) return "essa semana";

  const dayName = WEEK_DAYS.find((d) => normalized.includes(d));
  if (dayName) return dayName;

  const date = normalized.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);
  if (date?.[1]) return date[1];

  return undefined;
}

function extractServiceType(text: string): string | undefined {
  const normalized = normalizeText(text);
  const found = SERVICE_KEYWORDS.find((k) => normalized.includes(k.key));
  return found?.label;
}

function extractDesiredPeriod(text: string): "manha" | "tarde" | undefined {
  const normalized = normalizeText(text);
  if (/\b(manha|manhã|de manha|de manhã)\b/.test(normalized)) return "manha";
  if (/\b(tarde|de tarde)\b/.test(normalized)) return "tarde";
  return undefined;
}

export function detectIntent(text: string): Intent | null {
  const normalized = normalizeText(text);

  const hasGreeting = /^(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|opa)\b/.test(normalized);
  const wantsSchedule =
    /\b(agendar|agendamento|marcar|levar|encaixe|reservar|horario|horário)\b/.test(normalized);
  const asksAvailability =
    /\b(disponivel|disponível|disponibilidade|tem vaga|tem horario|tem horário)\b/.test(normalized);
  const asksQuote = /\b(orcamento|orçamento|preco|preço|valor|quanto fica)\b/.test(normalized);
  const asksLocationOrTime =
    /\b(endereco|endereço|localizacao|localização|onde fica|horario de funcionamento|horário de funcionamento)\b/.test(
      normalized
    );
  const hasGeneralQuestion = /\?/.test(normalized);

  if (asksLocationOrTime) return "localizacao_horario";
  if (wantsSchedule) return "agendamento_servico";
  if (asksAvailability) return "consulta_disponibilidade";
  if (asksQuote) return "orcamento";
  if (hasGreeting && normalized.length <= 30) return "saudacao";
  if (hasGeneralQuestion) return "duvidas_gerais";
  return null;
}

export function extractEntities(text: string): ExtractedEntities {
  const nome = extractName(text);
  const veiculo_ano = extractVehicleYear(text);
  const veiculo_modelo = extractVehicleModel(text);
  const quilometragem = extractMileage(text);
  const data_desejada = extractDesiredDate(text);
  const periodo_desejado = extractDesiredPeriod(text);
  const tipo_servico = extractServiceType(text);

  return {
    ...(nome ? { nome } : {}),
    ...(veiculo_modelo ? { veiculo_modelo } : {}),
    ...(veiculo_ano ? { veiculo_ano } : {}),
    ...(quilometragem ? { quilometragem } : {}),
    ...(data_desejada ? { data_desejada } : {}),
    ...(periodo_desejado ? { periodo_desejado } : {}),
    ...(tipo_servico ? { tipo_servico } : {}),
  };
}

export function analyzeMessage(text: string): NlpResult {
  const normalized = normalizeText(text);
  return {
    intent: detectIntent(text),
    entities: extractEntities(text),
    isAffirmative: /^(sim|isso|ok|pode|confirmo|fechado|pode ser)\b/.test(normalized),
    isNegative: /^(nao|não|negativo|deixa|cancelar)\b/.test(normalized),
  };
}
