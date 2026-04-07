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
import { eq, desc } from "drizzle-orm";
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

const VEHICLE_MEMORY_KEYS = new Set(["vehicle_model", "vehicle_year", "vehicle_km", "vehicle_oil_spec"]);

/** Últimas N mensagens enviadas ao modelo para evitar prompt excessivo */
const HISTORY_MESSAGE_LIMIT = 15;

const CONTEXT_PRIORITY_INSTRUCTION = `Use as seguintes prioridades ao responder:
1. Memórias do contato (informações já conhecidas)
2. Dados estruturados extraídos da conversa (veículo, etc.)
3. Histórico recente da conversa
4. Mensagem atual do cliente`;

const MEMORY_INSTRUCTION_DEFAULT = `Se o cliente informar algo relevante e duradouro (nome, email, preferência, veículo etc), adicione no FINAL da resposta:
[MEMÓRIA:chave=valor]

Use apenas para informações permanentes do cliente.
Não invente memórias.`;

const MEMORY_INSTRUCTION_VEHICLE = `Se o cliente informar algo relevante e duradouro (nome, email, preferências etc), adicione no FINAL da resposta:
[MEMÓRIA:chave=valor]

NÃO salve modelo, ano ou quilometragem em [MEMÓRIA:...] — são dados do atendimento, não do contato.
Use apenas para informações permanentes do cliente. Não invente memórias.`;

const TRAINING_EXAMPLES_INSTRUCTION = `Os exemplos abaixo mostram como um atendente humano responde aos clientes.
Use o mesmo tom, estilo e estrutura nas suas respostas.`;

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

export interface CustomerContext {
  name?: string;
  lastIntent?: string;
  preferredTopic?: string;
  keyFacts?: string[];
}

export interface GenerateAIReplyOptions {
  organizationId?: string;
  reservationsEnabled?: boolean;
  /** Slots extraídos pelo orquestrador - injetados no prompt para a IA não re-perguntar */
  vehicleSlots?: VehicleSlots;
  usesVehicleSlots?: boolean;
  /** Texto "Sobre" da empresa - a IA usa como contexto para responder naturalmente perguntas como "vocês são uma mecânica?" */
  businessAbout?: string | null;
  /** Contexto do cliente (perfil + memória de conversas anteriores) - Parte 3 */
  customerContext?: CustomerContext | null;
  /** Exemplares de respostas humanas para a IA seguir (Parte 5) */
  trainingExamples?: Array<{ id: string; userMessage: string; humanReply: string }>;
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
  // Prioridade: chave da Configurações (Agente de IA) → variável de ambiente GEMINI_API_KEY
  const apiKey = (apiKeyOverride?.trim() || process.env.GEMINI_API_KEY || "").trim() || null;
  if (!apiKey) {
    throw new Error("Chave da API Gemini não configurada. Defina em Configurações → Agente de IA ou na variável GEMINI_API_KEY.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const useReservationTools =
    !!options?.reservationsEnabled &&
    !!options?.organizationId;

  const [memories, recentMessagesDesc] = await Promise.all([
    getContactMemories(contactId),
    db
      .select({
        direction: messages.direction,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY_MESSAGE_LIMIT),
  ]);

  const memoriesForPrompt = Object.fromEntries(
    Object.entries(memories).filter(([k]) => !VEHICLE_MEMORY_KEYS.has(k.toLowerCase().trim()))
  );
  const memoriesBlock = formatMemoriesForPrompt(memoriesForPrompt);
  const recentChronological = [...recentMessagesDesc].reverse();
  const historyText = recentChronological
    .filter((m): m is { direction: string; content: string } => !!m.content)
    .map((m) =>
      m.direction === "inbound" ? `Cliente: ${m.content}` : `Atendente: ${m.content}`
    )
    .join("\n");

  const memoryInstruction = options?.usesVehicleSlots
    ? MEMORY_INSTRUCTION_VEHICLE
    : MEMORY_INSTRUCTION_DEFAULT;

  const sections: string[] = [];

  sections.push(`[SISTEMA]\n${systemPrompt}\n\n${CONTEXT_PRIORITY_INSTRUCTION}\n\n${memoryInstruction}\n\n${NATURAL_BEHAVIOR_INSTRUCTIONS}`);

  if (memoriesBlock) {
    sections.push(`[MEMÓRIAS DO CONTATO]\n${memoriesBlock}`);
  }

  if (options?.businessAbout?.trim()) {
    sections.push(`[CONTEXTO DA EMPRESA]\n${options.businessAbout.trim()}\nUse como contexto para perguntas como "vocês são uma mecânica?", "o que vocês fazem?". Responda de forma natural, sem copiar o texto literalmente.`);
  }

  if (options?.customerContext) {
    const cc = options.customerContext;
    const parts: string[] = [];
    if (cc.name) parts.push(`Nome: ${cc.name}`);
    if (cc.lastIntent || cc.preferredTopic)
      parts.push(`Último assunto: ${cc.preferredTopic ?? cc.lastIntent ?? "-"}`);
    if (cc.keyFacts && cc.keyFacts.length > 0) {
      parts.push(`Informações conhecidas:\n${cc.keyFacts.map((f) => `* ${f}`).join("\n")}`);
    }
    if (parts.length > 0) {
      sections.push(`[CONTEXTO DO CLIENTE]\n${parts.join("\n")}\nUse para personalizar a resposta (ex.: "Mateus, da última vez você comentou que usa óleo 5W30. O problema continua?").`);
    }
  }

  if (options?.trainingExamples && options.trainingExamples.length > 0) {
    const lines = options.trainingExamples.map(
      (ex, i) =>
        `Exemplo ${i + 1}\nCliente: ${ex.userMessage}\nHumano: ${ex.humanReply}`
    );
    sections.push(`[EXEMPLOS DE RESPOSTAS HUMANAS]\n${TRAINING_EXAMPLES_INSTRUCTION}\n\n${lines.join("\n\n")}`);
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
    const hasAllSlots = s.modelo && s.ano;
    if (parts.length > 0) {
      let vehicleBlock = `[DADOS EXTRAÍDOS DA CONVERSA]\nVeículo: ${parts.join(", ")}${missing.length > 0 ? ` | Falta: ${missing.join(", ")}` : ""}\nUse estes dados; NUNCA peça de novo.`;
      if (hasAllSlots && useReservationTools) {
        const userGaveDateTime = seemsToContainDateTime(newMessage);
        if (userGaveDateTime) {
          vehicleBlock += `\n\n[IMPORTANTE] O cliente informou data e horário nesta mensagem. Use check_availability AGORA. Converta para YYYY-MM-DD e HH:mm. NUNCA peça modelo/ano novamente.`;
        } else {
          vehicleBlock += `\n\n[IMPORTANTE] Você TEM check_availability e create_reservation. Pergunte qual data e horário prefere. PROIBIDO dizer "nossa equipe vai verificar" ou perguntar modelo/ano de novo.`;
        }
      }
      sections.push(vehicleBlock);
    }
  }

  if (useReservationTools) {
    sections.push(`[FUNÇÕES DE RESERVA]\n${RESERVATIONS_SYSTEM_ADDON}`);
  }

  if (historyText) {
    sections.push(`[HISTÓRICO RECENTE]\n${historyText}`);
  }

  sections.push(`[MENSAGEM ATUAL]\nCliente: ${newMessage}\n\nAtendente:`);

  const fullPrompt = sections.filter(Boolean).join("\n\n---\n\n");

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
    if (VEHICLE_MEMORY_KEYS.has(m.key?.toLowerCase().trim() ?? "")) continue;
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
