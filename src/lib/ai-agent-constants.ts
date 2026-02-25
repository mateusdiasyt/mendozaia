/**
 * Constantes do agente de IA - sem dependências de banco.
 * Pode ser importado por componentes client.
 */

export const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash"] as const;
export type GeminiModel = (typeof GEMINI_MODELS)[number];

export const DEFAULT_SYSTEM_PROMPT = `Você é um assistente de atendimento amigável e profissional no WhatsApp.
Responda de forma clara, objetiva e cordial.
Use linguagem natural e evite respostas muito longas.
Se não souber algo, seja honesto e sugira que a pessoa entre em contato com um atendente humano.`;
