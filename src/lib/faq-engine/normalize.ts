/**
 * Normalização de texto para agrupamento de perguntas similares.
 */

export function normalizeForFaq(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similaridade simples: proporção de palavras em comum (Jaccard-like). */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeForFaq(a);
  const nb = normalizeForFaq(b);
  if (!na || !nb) return 0;
  const setA = new Set(na.split(" ").filter((w) => w.length > 1));
  const setB = new Set(nb.split(" ").filter((w) => w.length > 1));
  if (setB.size === 0) return 0;
  let matches = 0;
  for (const w of setB) {
    if (setA.has(w)) matches++;
  }
  return matches / setB.size;
}
