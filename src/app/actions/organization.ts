"use server";

import { getCurrentOrganization } from "@/lib/auth-utils";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth-utils";
import { getCurrentMembership } from "@/lib/auth-utils";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { organizations, memberships } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

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
  botName?: string;
  instagram?: string;
  address?: string;
  mapsLink?: string;
}

export interface BotPersonalizationConfig {
  segment: "mecanica" | "restaurante" | "geral";
  tone: "formal" | "neutro" | "casual";
  language?: string;
  useAIFallback?: boolean;
}

const BILLING_PIX_KEY = "113.673.289-69";
const BILLING_PROOF_CONTACT = "45999287669";
const ALLOWED_PAID_PLANS = new Set(["starter", "pro", "scale"]);

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
    botName: (config.botName ?? "").trim() || null,
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

export async function updateBotPersonalizationConfig(
  config: BotPersonalizationConfig
) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};
  const botConfig = {
    segment: config.segment,
    tone: config.tone,
    language: (config.language ?? "pt-BR").trim() || "pt-BR",
  };

  await db
    .update(organizations)
    .set({
      settings: {
        ...settings,
        botConfig,
        aiAgent: {
          ...aiAgent,
          ...(typeof config.useAIFallback === "boolean"
            ? { useAsFallback: config.useAIFallback }
            : {}),
        },
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

export async function setActiveOrganization(organizationId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Não autorizado" };
  }

  const [membership] = await db
    .select({ organizationId: memberships.organizationId, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, session.user.id),
        eq(memberships.organizationId, organizationId),
        eq(organizations.status, "active")
      )
    )
    .limit(1);

  if (!membership) {
    return { error: "Organização inválida para este usuário" };
  }

  if (membership.role === "platform_admin") {
    return { error: "Conta de plataforma não possui escopo operacional por organização" };
  }

  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  revalidatePath("/dashboard");
  return { success: true };
}

export async function submitPaymentAndActivatePlan(plan: string) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };
  if (!ALLOWED_PAID_PLANS.has(plan)) {
    return { error: "Plano inválido" };
  }

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const billing = (settings.billing as Record<string, unknown> | undefined) ?? {};

  await db
    .update(organizations)
    .set({
      plan,
      settings: {
        ...settings,
        billing: {
          ...billing,
          status: "active",
          paymentMethod: "pix",
          pixKey: BILLING_PIX_KEY,
          proofContact: BILLING_PROOF_CONTACT,
          proofSentAt: new Date().toISOString(),
          activatedAt: new Date().toISOString(),
          activatedBy: "customer_self_service",
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/configuracoes");
  return { success: true };
}

export async function adminSetOrganizationPlan(
  organizationId: string,
  plan: "none" | "starter" | "pro" | "scale"
) {
  const membership = await getCurrentMembership();
  if (!membership || membership.role !== "platform_admin") {
    return { error: "Sem permissão" };
  }

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!current) {
    return { error: "Organização não encontrada" };
  }

  const settings = (current.settings as Record<string, unknown>) ?? {};
  const billing = (settings.billing as Record<string, unknown> | undefined) ?? {};
  const normalizedPlan = plan === "none" ? "none" : plan;
  const isPaidPlan = normalizedPlan !== "none";

  await db
    .update(organizations)
    .set({
      plan: normalizedPlan,
      settings: {
        ...settings,
        billing: {
          ...billing,
          status: isPaidPlan ? "active" : "inactive",
          activatedAt: isPaidPlan ? new Date().toISOString() : null,
          activatedBy: "platform_admin_manual",
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));

  revalidatePath("/dashboard/admin/usuarios");
  revalidatePath("/dashboard");
  return { success: true };
}
