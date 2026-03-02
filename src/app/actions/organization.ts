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

export interface ReservationScheduleConfig {
  start: string;
  end: string;
  timezone?: string;
  workingDays?: number[];
  blockedDates?: string[];
}

export interface BusinessProfileConfig {
  instagram?: string;
  address?: string;
  mapsLink?: string;
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

export async function updateReservationScheduleConfig(
  config: ReservationScheduleConfig
) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const safeWorkingDays = Array.isArray(config.workingDays)
    ? config.workingDays.filter(
        (d): d is number =>
          typeof d === "number" &&
          Number.isInteger(d) &&
          d >= 0 &&
          d <= 6
      )
    : [1, 2, 3, 4, 5];
  const safeBlockedDates = Array.isArray(config.blockedDates)
    ? config.blockedDates
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];

  const reservationSchedule: ReservationScheduleConfig = {
    start: config.start,
    end: config.end,
    timezone: config.timezone || "America/Sao_Paulo",
    workingDays: safeWorkingDays,
    blockedDates: safeBlockedDates,
  };

  await db
    .update(organizations)
    .set({
      settings: {
        ...settings,
        reservationSchedule,
        businessHours: {
          start: reservationSchedule.start,
          end: reservationSchedule.end,
          timezone: reservationSchedule.timezone,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  return { success: true };
}

export async function updateBusinessProfileConfig(config: BusinessProfileConfig) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const businessProfile = {
    instagram: (config.instagram ?? "").trim() || null,
    address: (config.address ?? "").trim() || null,
    mapsLink: (config.mapsLink ?? "").trim() || null,
  };

  await db
    .update(organizations)
    .set({
      settings: {
        ...settings,
        businessProfile,
      },
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
