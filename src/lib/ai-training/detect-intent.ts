/**
 * Detecta intenção para exemplos de treinamento.
 * Usado para categorizar e buscar exemplos relevantes.
 */

export type TrainingIntent =
  | "car_problem"
  | "booking"
  | "price_question"
  | "greeting"
  | "complaint"
  | "support"
  | "unknown";

const CAR_PROBLEM_PATTERNS = [
  /carro|veículo|veiculo|motor|óleo|oleo|vazando|vazamento|freio|pneu|bateria/i,
  /não\s+liga|não\s+funciona|barulho|estranho|problema\s+no\s+carro/i,
  /troca\s+de\s+óleo|revisão|revisao|manutenção/i,
];

const BOOKING_PATTERNS = [
  /agendar|marcar\s+(horário|hora|consulta|serviço)/i,
  /reservar|fazer\s+reserva|reserva\s+de\s+mesa/i,
  /disponível|disponibilidade|horário\s+livre/i,
];

const PRICE_PATTERNS = [
  /preço|preco|quanto\s+custa|valor|orçamento|orcamento|tabela\s+de\s+preço/i,
  /quanto\s+cobra|quanto\s+fica|valor\s+do\s+serviço/i,
];

const GREETING_PATTERNS = [
  /^(oi|olá|ola|opa|e\s*a[ií]|hey)\s*!?$/i,
  /^(bom\s+dia|boa\s+tarde|boa\s+noite)\s*!?$/i,
  /^(oi|olá)\s*,?\s*(bom\s+dia|boa\s+tarde|boa\s+noite)/i,
];

const COMPLAINT_PATTERNS = [
  /reclamação|reclamacao|reclamar|insatisfeito|péssimo|pessimo|ruim/i,
  /não\s+resolv(eu|veram)|demorou|atendimento\s+ruim/i,
];

const SUPPORT_PATTERNS = [
  /suporte|ajuda\s+técnica|assistência|dúvida|duvida/i,
  /como\s+faço|onde\s+fico|qual\s+o\s+horário/i,
];

export function detectIntent(message: string): TrainingIntent {
  const t = message.trim().toLowerCase();
  if (!t) return "unknown";

  for (const p of CAR_PROBLEM_PATTERNS) {
    if (p.test(t)) return "car_problem";
  }
  for (const p of BOOKING_PATTERNS) {
    if (p.test(t)) return "booking";
  }
  for (const p of PRICE_PATTERNS) {
    if (p.test(t)) return "price_question";
  }
  for (const p of GREETING_PATTERNS) {
    if (p.test(t)) return "greeting";
  }
  for (const p of COMPLAINT_PATTERNS) {
    if (p.test(t)) return "complaint";
  }
  for (const p of SUPPORT_PATTERNS) {
    if (p.test(t)) return "support";
  }

  if (t.includes("?") || /^(o\s+que|como|quando|onde|por\s+que|qual)/i.test(t)) {
    return "support";
  }

  return "unknown";
}
