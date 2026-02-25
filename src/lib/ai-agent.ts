/**
 * Agente de IA com Gemini - gera respostas baseadas no histórico da conversa.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { DEFAULT_SYSTEM_PROMPT } from "./ai-agent-constants";

export { GEMINI_MODELS, DEFAULT_SYSTEM_PROMPT } from "./ai-agent-constants";
export type { GeminiModel } from "./ai-agent-constants";

export async function generateAIReply(
  conversationId: string,
  newMessage: string,
  systemPrompt: string,
  model: string = "gemini-1.5-flash",
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

  const result = await genAI.getGenerativeModel({ model }).generateContent(prompt);
  const response = result.response;
  const text = response.text();

  if (!text) {
    throw new Error("Resposta vazia da IA");
  }

  return text.trim();
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

  const result = await genAI.getGenerativeModel({ model }).generateContent(prompt);
  const text = result.response.text();
  if (!text) throw new Error("Resposta vazia da IA");
  return text.trim();
}
