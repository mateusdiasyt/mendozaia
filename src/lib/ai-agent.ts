/**
 * Agente de IA com Gemini - gera respostas baseadas no histórico e memórias do contato.
 * Suporta function calling para reservas quando reservationsEnabled.
 */

import {
  GoogleGenerativeAI,
  GenerativeModel,
  type Content,
  type Part,
  type FunctionCall,
  type FunctionResponse,
} from "@google/generative-ai";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { DEFAULT_SYSTEM_PROMPT, RESERVATIONS_SYSTEM_ADDON, NATURAL_BEHAVIOR_INSTRUCTIONS } from "./ai-agent-constants";
import {
  getContactMemories,
  saveContactMemory,
  formatMemoriesForPrompt,
} from "./contact-memories";
import { reservationTools } from "./ai-reservation-tools";
import { createReservationFromAI } from "@/app/actions/reservations";
import { checkAvailabilityForOrg } from "@/lib/reservations";

export { GEMINI_MODELS, DEFAULT_SYSTEM_PROMPT } from "./ai-agent-constants";
export type { GeminiModel } from "./ai-agent-constants";

const MEMORY_EXTRACT_REGEX = /\[MEMÓRIA:([^=]+)=([^\]]*)\]/gi;

/** Detecta se a mensagem parece informar data e/ou horário para reserva */
function seemsToContainDateTime(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t || t.length < 5) return false;
  const monthNames = /janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i;
  const dayPattern = /dia\s+\d{1,2}|amanhã|hoje|próximo\s+(dia|sábado|domingo)/i;
  const timePattern = /às?\s*\d{1,2}(?::\d{2})?\s*h?|(\d{1,2})h\d{0,2}|(\d{1,2}):(\d{2})/i;
  const dateFormat = /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4}/;
  return !!(monthNames.test(t) || dayPattern.test(t) || timePattern.test(t) || dateFormat.test(t));
}

export interface VehicleSlots {
  modelo?: string;
  ano?: number;
  km?: number;
}

export interface GenerateAIReplyOptions {
  organizationId?: string;
  reservationsEnabled?: boolean;
  /** Slots extraídos pelo orquestrador - injetados no prompt para a IA não re-perguntar */
  vehicleSlots?: VehicleSlots;
  usesVehicleSlots?: boolean;
}

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

/** Executa uma função de reserva e retorna o resultado. */
async function executeReservationTool(
  name: string,
  args: Record<string, unknown>,
  organizationId: string,
  contactId: string
): Promise<object> {
  if (name === "check_availability") {
    const dateStr = String(args.dateStr ?? "");
    const timeStr = String(args.timeStr ?? "");
    const durationMinutes = Number(args.durationMinutes ?? 60) || 60;
    const { available, message } = await checkAvailabilityForOrg(
      organizationId,
      dateStr,
      timeStr,
      durationMinutes
    );
    return { available, message };
  }
  if (name === "create_reservation") {
    const dateStr = String(args.dateStr ?? "");
    const timeStr = String(args.timeStr ?? "");
    const durationMinutes = Number(args.durationMinutes ?? 60) || 60;
    const notes = args.notes ? String(args.notes) : undefined;
    const result = await createReservationFromAI(organizationId, {
      dateStr,
      timeStr,
      contactId,
      durationMinutes,
      notes,
    });
    if (result && "error" in result && result.error) {
      return { success: false, error: result.error };
    }
    const res = result as { reservation?: { id: string } };
    return { success: true, reservation: res?.reservation };
  }
  return { error: `Função desconhecida: ${name}` };
}

function extractAndRemoveMemories(text: string): {
  cleanReply: string;
  memories: Array<{ key: string; value: string }>;
} {
  const memories: Array<{ key: string; value: string }> = [];
  const cleanReply = text.replace(MEMORY_EXTRACT_REGEX, (_, key, value) => {
    memories.push({ key: key?.trim() ?? "", value: value?.trim() ?? "" });
    return "";
  });
  return {
    cleanReply: cleanReply.replace(/\n{3,}/g, "\n\n").trim(),
    memories: memories.filter((m) => m.key && m.value),
  };
}

export async function generateAIReply(
  conversationId: string,
  contactId: string,
  newMessage: string,
  systemPrompt: string,
  model: string = "gemini-2.0-flash",
  apiKeyOverride?: string | null,
  options?: GenerateAIReplyOptions
): Promise<string> {
  const apiKey = apiKeyOverride ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Chave da API Gemini não configurada. Defina em Configurações → Agente de IA ou na variável GEMINI_API_KEY.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const useReservationTools =
    !!options?.reservationsEnabled &&
    !!options?.organizationId;

  const [memories, recentMessages] = await Promise.all([
    getContactMemories(contactId),
    db
      .select({
        direction: messages.direction,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .limit(50),
  ]);

  const memoriesBlock = formatMemoriesForPrompt(memories);
  const historyText = recentMessages
    .filter((m): m is { direction: string; content: string } => !!m.content)
    .map((m) =>
      m.direction === "inbound" ? `Cliente: ${m.content}` : `Atendente: ${m.content}`
    )
    .join("\n");

  const memoryInstruction = `
Quando o cliente informar algo importante (nome, email, preferências, pedido, etc.), adicione no FINAL da sua resposta, em linhas separadas: [MEMÓRIA:chave=valor]
Exemplo: se o cliente disser "meu nome é João", termine sua resposta com: [MEMÓRIA:name=João]
Use apenas uma linha por informação. Não invente informações.`;

  let basePrompt = memoriesBlock
    ? `${systemPrompt}

${memoriesBlock}
${memoryInstruction}

${NATURAL_BEHAVIOR_INSTRUCTIONS}`
    : `${systemPrompt}
${memoryInstruction}

${NATURAL_BEHAVIOR_INSTRUCTIONS}`;

  if (useReservationTools) {
    basePrompt += `\n${RESERVATIONS_SYSTEM_ADDON}`;
  }

  if (options?.usesVehicleSlots && options?.vehicleSlots) {
    const s = options.vehicleSlots;
    const parts: string[] = [];
    if (s.modelo) parts.push(`modelo=${s.modelo}`);
    if (s.ano) parts.push(`ano=${s.ano}`);
    if (s.km) parts.push(`quilometragem=${s.km.toLocaleString("pt-BR")} km`);
    const missing: string[] = [];
    if (!s.modelo) missing.push("modelo");
    if (!s.ano) missing.push("ano");
    if (!s.km) missing.push("quilometragem");
    const hasAllSlots = s.modelo && s.ano && s.km;
    if (parts.length > 0) {
      basePrompt += `

[DADOS EXTRAÍDOS DA CONVERSA - use estes dados, NUNCA peça de novo]
Veículo: ${parts.join(", ")}${missing.length > 0 ? ` | Falta: ${missing.join(", ")}` : ""}`;
    }
    // Cliente já completou modelo/ano/km E temos funções de reserva
    if (hasAllSlots && useReservationTools) {
      const userGaveDateTime = seemsToContainDateTime(newMessage);
      if (userGaveDateTime) {
        basePrompt += `

[IMPORTANTE] O cliente informou data e horário nesta mensagem. Você TEM check_availability e create_reservation.
Use check_availability AGORA com a data e horário que o cliente indicou. Converta para YYYY-MM-DD e HH:mm. Ex: "dia 26 de fevereiro às 14h" → 2025-02-26, 14:00.
NUNCA peça modelo/ano/km novamente — já estão em [DADOS EXTRAÍDOS].`;
      } else {
        basePrompt += `

[IMPORTANTE] O cliente já informou modelo, ano e quilometragem. Você TEM as funções check_availability e create_reservation.
Sua resposta AGORA: pergunte qual data e horário prefere. Ex.: "Posso consultar a disponibilidade e já reservar um horário para você. Qual data e horário prefere?"
PROIBIDO dizer "nossa equipe vai verificar", "retornar em breve" ou perguntar modelo/ano/km de novo.`;
      }
    }
  }

  const fullPrompt = historyText
    ? `${basePrompt}

Histórico recente da conversa:
${historyText}

Cliente: ${newMessage}

Atendente:`
    : `${basePrompt}

Cliente: ${newMessage}

Atendente:`;

  const modelParams: { model: string; tools?: Array<typeof reservationTools> } = {
    model,
  };
  if (useReservationTools) {
    modelParams.tools = [reservationTools];
  }

  const generativeModel = genAI.getGenerativeModel(modelParams);

  let rawReply: string;

  if (useReservationTools && options?.organizationId) {
    rawReply = await generateWithTools(
      generativeModel,
      fullPrompt,
      options.organizationId,
      contactId
    );
  } else {
    rawReply = await generateWithRetry(generativeModel, fullPrompt);
  }

  const { cleanReply, memories: newMemories } = extractAndRemoveMemories(rawReply);

  for (const m of newMemories) {
    try {
      await saveContactMemory(contactId, m.key, m.value);
    } catch (err) {
      console.error("[ai-agent] Failed to save memory:", err);
    }
  }

  return cleanReply || rawReply;
}

/** Loop de function calling: chama o modelo, executa funções se houver, repete até texto final. */
async function generateWithTools(
  model: GenerativeModel,
  initialPrompt: string,
  organizationId: string,
  contactId: string
): Promise<string> {
  const contents: Content[] = [
    { role: "user", parts: [{ text: initialPrompt }] },
  ];
  const maxTurns = 5;
  let turns = 0;

  while (turns < maxTurns) {
    turns++;
    const result = await model.generateContent({ contents });
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      const text = response.text?.();
      return text?.trim() || "Desculpe, não consegui processar sua solicitação.";
    }

    const parts = candidate.content.parts;
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let textPart = "";

    for (const part of parts as Part[]) {
      if ("functionCall" in part && part.functionCall) {
        const fc = part.functionCall as FunctionCall;
        functionCalls.push({
          name: fc.name,
          args: (fc.args || {}) as Record<string, unknown>,
        });
      }
      if ("text" in part && typeof part.text === "string") {
        textPart = part.text;
      }
    }

    if (textPart && functionCalls.length === 0) {
      return textPart.trim();
    }

    if (functionCalls.length === 0) {
      return "Desculpe, ocorreu um problema ao processar.";
    }

    const modelParts: Part[] = [...parts];
    const functionResponses: Part[] = [];

    for (const fc of functionCalls) {
      const response = await executeReservationTool(
        fc.name,
        fc.args,
        organizationId,
        contactId
      );
      functionResponses.push({
        functionResponse: {
          name: fc.name,
          response,
        } as FunctionResponse,
      });
    }

    contents.push({
      role: "model",
      parts: modelParts,
    });
    contents.push({
      role: "user",
      parts: functionResponses,
    });
  }

  return "Desculpe, não consegui concluir a solicitação. Tente novamente.";
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
