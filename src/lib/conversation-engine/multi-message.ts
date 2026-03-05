/**
 * Formatação de respostas em múltiplas mensagens (estilo WhatsApp real).
 * Delay por mensagem: 700ms + (tamanho * 35ms)
 */

export const MULTI_MESSAGE_DELAY_BASE_MS = 700;
export const MULTI_MESSAGE_DELAY_PER_CHAR_MS = 35;

export function calculateMessageDelay(messageLength: number): number {
  return MULTI_MESSAGE_DELAY_BASE_MS + messageLength * MULTI_MESSAGE_DELAY_PER_CHAR_MS;
}

/**
 * Divide texto longo em mensagens menores (por frases/sentenças).
 * Usado quando a IA retorna uma única string longa.
 */
export function splitIntoMessages(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts: string[] = [];
  const sentences = trimmed.split(/(?<=[.!?])\s+|\n+/);
  let current = "";

  for (const s of sentences) {
    const frag = s.trim();
    if (!frag) continue;
    if (current.length + frag.length + 1 <= 200) {
      current = current ? `${current} ${frag}` : frag;
    } else {
      if (current) parts.push(current);
      current = frag;
    }
  }
  if (current) parts.push(current);

  return parts.length > 0 ? parts : [trimmed];
}

/**
 * Verifica se o texto parece ser JSON com { messages: [...] }
 */
export function parseMessagesResponse(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { messages?: string[] };
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return parsed.messages.filter((m) => typeof m === "string" && m.trim());
    }
  } catch {
    // ignore
  }
  return null;
}
