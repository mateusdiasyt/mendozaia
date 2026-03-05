/**
 * Classificador leve de intenção (regex/keywords).
 * Executado antes da IA principal.
 */

export type DetectedIntent =
  | "GREETING"
  | "QUESTION"
  | "SUPORTE_TECNICO"
  | "INFORMACAO_PRODUTO"
  | "AGENDAR_SERVICO"
  | "PEDIR_ATENDENTE";

const PEDIR_ATENDENTE_PATTERNS = [
  /quero\s+fal(ar|lhar)\s+com\s+(um\s+)?(atendente|humano|pessoa)/i,
  /tem\s+(humano|atendente|alguém)\s+a[ií]/i,
  /falar\s+com\s+(atendente|humano|alguém)/i,
  /atendente\s+humano/i,
  /transferir\s+para\s+(humano|atendente)/i,
  /falar\s+com\s+pessoa/i,
  /não\s+quero\s+fal(ar|lhar)\s+com\s+(bot|robô|máquina)/i,
];

const GREETING_PATTERNS = [
  /^(oi|olá|ola|opa|e\s*a[ií]|hey)\s*!?$/i,
  /^(bom\s+dia|boa\s+tarde|boa\s+noite)\s*!?$/i,
  /^(oi|olá)\s*,?\s*(bom\s+dia|boa\s+tarde|boa\s+noite)/i,
];

const AGENDAR_PATTERNS = [
  /agendar|marcar\s+(horário|hora|consulta|serviço)/i,
  /reservar|fazer\s+reserva/i,
  /disponível\s+(para|em)\s+\d/i,
  /quero\s+agendar/i,
];

const SUPORTE_PATTERNS = [
  /problema|não\s+funciona|erro|bug|quebrou/i,
  /suporte|ajuda\s+técnica|assistência\s+técnica/i,
];

const PRODUTO_PATTERNS = [
  /preço|quanto\s+custa|valor\s+do/i,
  /produto|óleo|qual\s+óleo|tipo\s+de\s+óleo/i,
  /tem\s+(disponível|em\s+estoque)/i,
];

export function classifyIntent(text: string): DetectedIntent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  for (const p of PEDIR_ATENDENTE_PATTERNS) {
    if (p.test(t)) return "PEDIR_ATENDENTE";
  }

  for (const p of GREETING_PATTERNS) {
    if (p.test(t)) return "GREETING";
  }

  for (const p of AGENDAR_PATTERNS) {
    if (p.test(t)) return "AGENDAR_SERVICO";
  }

  for (const p of SUPORTE_PATTERNS) {
    if (p.test(t)) return "SUPORTE_TECNICO";
  }

  for (const p of PRODUTO_PATTERNS) {
    if (p.test(t)) return "INFORMACAO_PRODUTO";
  }

  if (t.includes("?") || /^(o\s+que|como|quando|onde|por\s+que|qual)/i.test(t)) {
    return "QUESTION";
  }

  return null;
}
