/**
 * Detecção leve de frustração por keywords.
 */

const FRUSTRATION_PATTERNS = [
  /não\s+resolveu/i,
  /não\s+entendi/i,
  /isso\s+não\s+ajuda/i,
  /quero\s+fal(ar|lhar)\s+com\s+atendente/i,
  /tem\s+humano\s+a[ií]/i,
  /vocês\s+não\s+respondem\s+(direito|bem)/i,
  /não\s+está\s+entendendo/i,
  /já\s+disse\s+(isso|várias\s+vezes)/i,
  /que\s+ruim|muito\s+ruim/i,
  /péssimo\s+atendimento/i,
  /ninguém\s+entende/i,
];

export function detectFrustration(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return FRUSTRATION_PATTERNS.some((p) => p.test(t));
}
