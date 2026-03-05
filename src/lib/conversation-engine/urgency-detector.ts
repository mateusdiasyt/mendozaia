/**
 * Detecção leve de urgência por keywords.
 */

const URGENCY_PATTERNS = [
  /urgente/i,
  /preciso\s+agora/i,
  /emergência/i,
  /emergencia/i,
  /não\s+posso\s+esperar/i,
  /preciso\s+urgente/i,
  /com\s+urgência/i,
  /com\s+urgencia/i,
  /rápido/i,
  /rapido/i,
  /o\s+mais\s+rápido/i,
  /asap/i,
];

export function detectUrgency(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return URGENCY_PATTERNS.some((p) => p.test(t));
}
