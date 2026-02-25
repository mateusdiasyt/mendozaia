/**
 * Agente de IA com Gemini - gera respostas baseadas no histórico da conversa.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro"] as const;
export type GeminiModel = (typeof GEMINI_MODELS)[number];

export const DEFAULT_SYSTEM_PROMPT = `Você é um assistente de atendimento amigável e profissional no WhatsApp.
Responda de forma clara, objetiva e cordial.
Use linguagem natural e evite respostas muito longas.
Se não souber algo, seja honesto e sugira que a pessoa entre em contato com um atendente humano.`;

export async function generateAIReply(
  conversationId: string,
  newMessage: string,
  systemPrompt: string,
  model: string = "gemini-1.5-flash"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada");
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
