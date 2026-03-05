/**
 * Utilitários para comportamento mais humano da IA.
 */

/** Fillers ocasionais (máx 1 a cada 3 respostas) */
export const FILLERS = [
  "Entendi.",
  "Boa pergunta.",
  "Deixa eu te explicar.",
  "Certo.",
  "Beleza.",
];

/** Retorna filler ocasional quando responseIndex % 3 === 0 */
export function maybeAddFiller(responseIndex: number): string | null {
  if (responseIndex % 3 !== 0) return null;
  const idx = Math.floor(Math.random() * FILLERS.length);
  return FILLERS[idx] ?? null;
}

/** Delay baseado no tamanho da mensagem (simula tempo de leitura) */
export function calculateHumanDelay(messageLength: number): number {
  if (messageLength <= 20) return 1_000;
  if (messageLength <= 80) return 2_000;
  if (messageLength <= 200) return 3_000;
  return 4_000;
}

/** Delay aleatório entre min e max (ms) */
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/** Variações de "Qual é o seu nome?" para naturalidade (Parte 9) */
export const NAME_QUESTION_VARIATIONS = [
  "Qual é o seu nome?",
  "Como posso te chamar?",
  "Pra eu te atender melhor, qual seu nome?",
  "Qual seu nome?",
  "Como você se chama?",
];

export function getRandomNameQuestion(): string {
  const idx = Math.floor(Math.random() * NAME_QUESTION_VARIATIONS.length);
  return NAME_QUESTION_VARIATIONS[idx] ?? "Qual é o seu nome?";
}

/** Variações para contexto "para continuarmos" */
const CONTINUATION_NAME_VARIATIONS = [
  "qual é o seu nome?",
  "como posso te chamar?",
  "qual seu nome?",
];

export function getRandomContinuationNameQuestion(): string {
  const idx = Math.floor(Math.random() * CONTINUATION_NAME_VARIATIONS.length);
  return CONTINUATION_NAME_VARIATIONS[idx] ?? "qual é o seu nome?";
}

/** Variações leves de frases comuns (nunca altera significado) */
const PHRASE_VARIATIONS: Record<string, string[]> = {
  "Claro, posso te ajudar com isso.": [
    "Claro, posso te ajudar com isso.",
    "Sim, consigo te ajudar com isso.",
    "Beleza, vamos resolver isso.",
  ],
  "Claro!": ["Claro!", "Sim!", "Beleza!"],
  "Entendi.": ["Entendi.", "Certo.", "Beleza."],
  "Perfeito!": ["Perfeito!", "Ótimo!", "Excelente!"],
  "De nada.": ["De nada.", "Por nada.", "Imagina."],
  "Obrigado.": ["Obrigado.", "Valeu.", "Obrigada."],
  "Tudo bem?": ["Tudo bem?", "Como vai?", "E aí?"],
  "Posso ajudar?": ["Posso ajudar?", "Em que posso ajudar?", "Como posso ajudar?"],
};

/**
 * Aplica variação leve em respostas (nunca altera significado).
 * Se houver match exato, retorna variação aleatória. Senão, retorna original.
 */
export function humanizeTextResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  for (const [phrase, variations] of Object.entries(PHRASE_VARIATIONS)) {
    if (trimmed === phrase || trimmed.startsWith(phrase + " ") || trimmed.endsWith(" " + phrase)) {
      const idx = Math.floor(Math.random() * variations.length);
      return trimmed === phrase
        ? variations[idx]!
        : trimmed.replace(phrase, variations[idx]!);
    }
  }

  return text;
}
