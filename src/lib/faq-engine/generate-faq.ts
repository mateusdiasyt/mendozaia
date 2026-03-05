/**
 * Gera entrada de FAQ automaticamente: pergunta repetida + melhores respostas humanas → IA gera resposta base.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { faqEntries } from "@/lib/db/schema";
import { findRelevantExamples } from "@/lib/ai-training";
import { detectIntent } from "@/lib/ai-training/detect-intent";
import { textSimilarity } from "./normalize";
import type { RepeatedQuestionGroup } from "./detect-repeated-questions";

const FAQ_GENERATION_PROMPT = `Você é um assistente que cria respostas curtas para FAQ.
Com base na pergunta do cliente e nas respostas humanas de referência, gere UMA resposta clara e objetiva (1 a 3 frases).
Não invente informações que não estejam nas referências. Use tom profissional e direto.
Responda apenas com o texto da resposta, sem prefixos como "Resposta:" ou "FAQ:".`;

export interface GenerateFAQEntryInput {
  organizationId: string;
  question: string;
  intent: string;
  humanReplyExamples?: Array<{ userMessage: string; humanReply: string }>;
}

/** Gera resposta para FAQ via IA e salva em faq_entries. */
export async function generateFAQEntry(
  input: GenerateFAQEntryInput
): Promise<string | null> {
  const apiKey =
    process.env.GEMINI_API_KEY ?? (process.env as Record<string, string>).GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[faq-engine] GEMINI_API_KEY não configurada; FAQ não gerada.");
    return null;
  }

  const examples = input.humanReplyExamples ?? (await findRelevantExamples(
    input.organizationId,
    input.question,
    3
  ));

  const examplesBlock =
    examples.length > 0
      ? examples
          .map(
            (ex) =>
              `Pergunta: ${ex.userMessage}\nResposta humana: ${ex.humanReply}`
          )
          .join("\n\n")
      : "Sem respostas humanas de referência. Gere uma resposta genérica e útil.";

  const prompt = `${FAQ_GENERATION_PROMPT}

Pergunta do cliente: ${input.question}

Respostas humanas de referência:
${examplesBlock}

Sua resposta (apenas o texto):`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  let answer: string;
  try {
    const result = await model.generateContent(prompt);
    answer = result.response.text()?.trim() ?? "";
  } catch (err) {
    console.error("[faq-engine] generateFAQEntry IA error:", err);
    return null;
  }

  if (!answer) return null;

  const intent = input.intent || detectIntent(input.question);
  const [row] = await db
    .insert(faqEntries)
    .values({
      organizationId: input.organizationId,
      question: input.question.trim(),
      answer,
      intent,
      usageCount: 0,
      confidenceScore: 100,
    })
    .returning({ id: faqEntries.id });

  return row?.id ?? null;
}

/** Para um grupo de pergunta repetida, gera FAQ se ainda não existir entrada similar. */
export async function generateFAQFromRepeatedGroup(
  organizationId: string,
  group: RepeatedQuestionGroup
): Promise<string | null> {
  const similar = await db
    .select({ id: faqEntries.id, question: faqEntries.question })
    .from(faqEntries)
    .where(eq(faqEntries.organizationId, organizationId));

  const alreadyExists = similar.some(
    (s) => textSimilarity(s.question, group.canonicalQuestion) >= 0.8
  );
  if (alreadyExists) return null;

  return generateFAQEntry({
    organizationId,
    question: group.canonicalQuestion,
    intent: group.intent,
  });
}
