/**
 * Prevenção de loop de IA.
 * Se o bot respondeu 3 vezes seguidas e o usuário respondeu "não entendi",
 * transferir para humano automaticamente.
 */

const LOOP_DETECTION_PATTERNS = [
  /não\s+entendi/i,
  /nao\s+entendi/i,
  /não\s+compreendi/i,
  /continua\s+sem\s+entender/i,
];

export function isLoopConfusion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return LOOP_DETECTION_PATTERNS.some((p) => p.test(t));
}
