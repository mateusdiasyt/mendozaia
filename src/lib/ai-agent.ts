/**
 * Agente de IA com Gemini - gera respostas baseadas no histórico da conversa.
 */

import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { DEFAULT_SYSTEM_PROMPT } from "./ai-agent-constants";

export { GEMINI_MODELS, DEFAULT_SYSTEM_PROMPT } from "./ai-agent-constants";
export type { GeminiModel } from "./ai-agent-constants";

/** Retry com backoff ao receber 429 (rate limit). */
async function generateWithRetry(
  model: GenerativeModel,
  prompt: string,
  maxRetries = 3
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (!text) throw new Error("Resposta vazia da IA");
      return text.trim();
    } catch (err) {
      lastError = err;
      const msg = String(err);
      const is429 = msg.includes("429") || msg.includes("Resource exhausted");
      if (is429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

export async function generateAIReply(
  conversationId: string,
  newMessage: string,
  systemPrompt: string,
  model: string = "gemini-2.0-flash",
  apiKeyOverride?: string | null
): Promise<string> {
  const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Chave da API Gemini não configurada. Defina em Configurações → Agente de IA ou na variável GEMINI_API_KEY.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const recentMessages = await db
    .select({
      direction: messages.direction,
      content: messages.content,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(30);

  const historyText = recentMessages
    .filter((m): m is { direction: string; content: string } => !!m.content)
    .map((m) =>
      m.direction === "inbound" ? `Cliente: ${m.content}` : `Atendente: ${m.content}`
    )
    .join("\n");

  const prompt = historyText
    ? `${systemPrompt}

Histórico da conversa:
${historyText}

Cliente: ${newMessage}

Atendente:`
    : `${systemPrompt}

Cliente: ${newMessage}

Atendente:`;

  const generativeModel = genAI.getGenerativeModel({ model });
  return generateWithRetry(generativeModel, prompt);
}

/** Testa a conexão com o Gemini sem precisar de conversa. */
export async function testAIConnection(
  systemPrompt: string,
  model: string,
  apiKeyOverride?: string | null
): Promise<string> {
  const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Chave da API Gemini não configurada.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const prompt = `${systemPrompt}

Cliente: Oi, tudo bem?

Atendente:`;

  const generativeModel = genAI.getGenerativeModel({ model });
  return generateWithRetry(generativeModel, prompt);
}
