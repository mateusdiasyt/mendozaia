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
