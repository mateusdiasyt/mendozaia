"use server";

import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface AiAgentConfig {
  enabled?: boolean;
  useAsFallback?: boolean;
  systemPrompt?: string;
  model?: string;
  /** Chave da API Gemini. Envie string para definir/atualizar, "" para limpar. Não envie para manter. */
  apiKey?: string;
}

export async function updateAiAgentConfig(config: AiAgentConfig) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};

  const merged: Record<string, unknown> = {
    ...aiAgent,
    ...(config.enabled !== undefined && { enabled: config.enabled }),
    ...(config.useAsFallback !== undefined && { useAsFallback: config.useAsFallback }),
    ...(config.systemPrompt !== undefined && { systemPrompt: config.systemPrompt }),
    ...(config.model !== undefined && { model: config.model }),
    ...(config.apiKey !== undefined && { apiKey: config.apiKey || null }),
  };

  await db
    .update(organizations)
    .set({
      settings: { ...settings, aiAgent: merged },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  return { success: true };
}

export async function updateReservationsEnabled(enabled: boolean) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};

  await db
    .update(organizations)
    .set({
      settings: { ...settings, reservationsEnabled: enabled },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  return { success: true };
}

export async function testAiAgentConnection() {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};

  const { testAIConnection } = await import("@/lib/ai-agent");
  const { DEFAULT_SYSTEM_PROMPT } = await import("@/lib/ai-agent-constants");

  try {
    const reply = await testAIConnection(
      (aiAgent.systemPrompt as string) || DEFAULT_SYSTEM_PROMPT,
      (aiAgent.model as string) || "gemini-2.0-flash",
      (aiAgent.apiKey as string) || undefined
    );
    return { success: true, reply };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.includes("Resource exhausted")) {
      return {
        error: "Limite de requisições atingido. Aguarde alguns minutos e tente novamente.",
      };
    }
    return { error: msg };
  }
}
