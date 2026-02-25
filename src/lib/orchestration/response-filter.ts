/**
 * Filtro de resposta final - valida e sanitiza antes de enviar ao usuário.
 */

const MAX_RESPONSE_LENGTH = 4000;
const MIN_RELEVANT_LENGTH = 2;

/** Remove trechos suspeitos (alucinação, vazamento de prompt). */
function sanitizeContent(text: string): string {
  let out = text;
  out = out.replace(/\[MEMÓRIA:[^\]]*\]/gi, "").trim();
  out = out.replace(/\[INSTRUÇÃO[^\]]*\]/gi, "").trim();
  out = out.replace(/As an AI assistant/gi, "").trim();
  out = out.replace(/I am an AI/gi, "").trim();
  out = out.replace(/sou um assistente de IA/gi, "").trim();
  out = out.replace(/sou uma IA/gi, "").trim();
  out = out.replace(/\n{4,}/g, "\n\n\n");
  return out.trim();
}

/** Garante formatação adequada para WhatsApp. */
function formatForWhatsApp(text: string): string {
  let out = text;
  out = out.replace(/\*\*(.+?)\*\*/g, "*$1*");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

export function filterResponse(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;

  let text = raw.trim();
  if (text.length < MIN_RELEVANT_LENGTH) return null;

  text = sanitizeContent(text);
  text = formatForWhatsApp(text);

  if (text.length > MAX_RESPONSE_LENGTH) {
    text = text.slice(0, MAX_RESPONSE_LENGTH - 3) + "...";
  }

  return text || null;
}
