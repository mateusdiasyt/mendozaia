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
import {
  findBestWhatsappSessionIdForOrg,
  normalizeGroupId,
  parseReservationGroupNotifications,
  sendTextToWhatsAppGroup,
} from "@/lib/whatsapp-group-notifications";

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
  about?: string;
}

export interface BotPersonalizationConfig {
  segment: "mecanica" | "restaurante" | "geral";
  tone: "formal" | "neutro" | "casual";
  language?: string;
  useAIFallback?: boolean;
}

export interface VehicleServicePolicyConfig {
  minAllowedYear?: number | null;
  supportedModels?: string[];
  blockedModels?: string[];
}

export interface OfferedServicesConfig {
  selectedServices?: string[];
}

export interface ReservationGroupNotificationsConfigInput {
  enabled?: boolean;
  groupId?: string | null;
  detectedGroupIds?: string[];
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

export async function updateReservationGroupNotificationsConfig(
  input: ReservationGroupNotificationsConfigInput
) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Nao autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const currentConfig = parseReservationGroupNotifications(
    settings.reservationGroupNotifications
  );

  const mergedDetected = Array.isArray(input.detectedGroupIds)
    ? input.detectedGroupIds
    : currentConfig.detectedGroupIds;
  const normalizedGroupId =
    input.groupId === undefined
      ? currentConfig.groupId
      : normalizeGroupId(input.groupId);

  const nextConfig = parseReservationGroupNotifications({
    enabled:
      typeof input.enabled === "boolean" ? input.enabled : currentConfig.enabled,
    groupId: normalizedGroupId,
    detectedGroupIds: mergedDetected,
    updatedAt: new Date().toISOString(),
  });

  await db
    .update(organizations)
    .set({
      settings: {
        ...settings,
        reservationGroupNotifications: nextConfig,
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  revalidatePath("/dashboard/configuracoes");
  revalidatePath("/dashboard");
  return { success: true, config: nextConfig };
}

export async function sendReservationGroupNotificationsTest() {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Nao autorizado" };

  const settings = (org.settings as Record<string, unknown>) ?? {};
  const config = parseReservationGroupNotifications(
    settings.reservationGroupNotifications
  );

  if (!config.groupId) {
    return { error: "Informe um grupo antes de enviar teste." };
  }

  const sessionId = await findBestWhatsappSessionIdForOrg(org.id);
  if (!sessionId) {
    return { error: "Nenhuma sessao WhatsApp encontrada para envio." };
  }

  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(now);
  const timeLabel = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(now);

  const text = [
    `*Agendamentos de hoje (${dateLabel})*`,
    "",
    "---------------------",
    `Horario: ${timeLabel}`,
    "Sobre: Mensagem de teste",
    "Carro: Exemplo",
    "KM: 70000",
    "Ano: 2022",
    "Cliente: Teste",
    "---------------------",
  ].join("\n");

  const sent = await sendTextToWhatsAppGroup({
    sessionId,
    groupId: config.groupId,
    text,
  });

  if (!sent.ok) {
    return {
      error:
        sent.error ||
        "Falha ao enviar teste para o grupo. Verifique sessao e ID do grupo.",
    };
  }

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
    about: (config.about ?? "").trim() || null,
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

export async function updateVehicleServicePolicyConfig(
  config: VehicleServicePolicyConfig
) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};

  const minAllowedYearRaw =
    typeof config.minAllowedYear === "number" && Number.isFinite(config.minAllowedYear)
      ? Math.trunc(config.minAllowedYear)
      : null;
  const minAllowedYear =
    minAllowedYearRaw && minAllowedYearRaw >= 1980 && minAllowedYearRaw <= 2035
      ? minAllowedYearRaw
      : null;

  const blockedModelsRaw = Array.isArray(config.blockedModels)
    ? Array.from(
        new Set(
          config.blockedModels
            .filter((m): m is string => typeof m === "string")
            .map((m) => m.trim())
            .filter((m) => m.length >= 2 && m.length <= 60)
            .map((m) => m.toLowerCase())
        )
      )
    : [];

  const supportedModels = Array.isArray(config.supportedModels)
    ? Array.from(
        new Set(
          config.supportedModels
            .filter((m): m is string => typeof m === "string")
            .map((m) => m.trim())
            .filter((m) => m.length >= 2 && m.length <= 80)
            .map((m) => m.toLowerCase())
        )
      )
    : [];

  // O bloqueio por modelo deve refletir apenas modelos cadastrados em "veiculos atendidos".
  const supportedSet = new Set(supportedModels);
  const blockedModels = blockedModelsRaw.filter((model) => supportedSet.has(model));

  await db
    .update(organizations)
    .set({
      settings: {
        ...settings,
        vehicleServicePolicy: {
          minAllowedYear,
          supportedModels,
          blockedModels,
          updatedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  revalidatePath("/dashboard/configuracoes");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateOfferedServicesConfig(config: OfferedServicesConfig) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [current] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);

  const settings = (current?.settings as Record<string, unknown>) ?? {};
  const selectedServices = Array.isArray(config.selectedServices)
    ? Array.from(
        new Set(
          config.selectedServices
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item.length >= 2 && item.length <= 80)
            .map((item) => item.toLowerCase())
        )
      )
    : [];

  await db
    .update(organizations)
    .set({
      settings: {
        ...settings,
        offeredServicesConfig: {
          selectedServices,
          updatedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  revalidatePath("/dashboard/configuracoes");
  revalidatePath("/dashboard");
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

export async function submitPaymentProof(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };
  const plan = String(formData.get("plan") ?? "").trim();
  if (!ALLOWED_PAID_PLANS.has(plan)) return { error: "Plano inválido" };

  const proofFile = formData.get("proofFile");
  if (!(proofFile instanceof File) || proofFile.size <= 0) {
    return { error: "Envie um arquivo de comprovante" };
  }

  const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  if (proofFile.size > MAX_FILE_SIZE_BYTES) {
    return { error: "Arquivo muito grande. Use até 5MB." };
  }

  const mimeType = proofFile.type || "application/octet-stream";
  const isSupported =
    mimeType.startsWith("image/") || mimeType === "application/pdf";
  if (!isSupported) {
    return { error: "Formato inválido. Envie imagem ou PDF." };
  }

  const bytes = Buffer.from(await proofFile.arrayBuffer());
  const base64 = bytes.toString("base64");
  const proofFileDataUrl = `data:${mimeType};base64,${base64}`;

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
      settings: {
        ...settings,
        billing: {
          ...billing,
          status: "pending_approval",
          requestedPlan: plan,
          paymentMethod: "pix",
          pixKey: BILLING_PIX_KEY,
          proofContact: BILLING_PROOF_CONTACT,
          proofFileName: proofFile.name || "comprovante",
          proofFileMimeType: mimeType,
          proofFileDataUrl,
          proofSubmittedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/configuracoes");
  revalidatePath("/dashboard/admin/usuarios");
  return { success: true };
}

export async function adminReviewPaymentRequest(
  organizationId: string,
  decision: "approve" | "deny"
) {
  const membership = await getCurrentMembership();
  if (!membership || membership.role !== "platform_admin") {
    return { error: "Sem permissão" };
  }

  const [current] = await db
    .select({ plan: organizations.plan, settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!current) return { error: "Organização não encontrada" };

  const settings = (current.settings as Record<string, unknown>) ?? {};
  const billing = (settings.billing as Record<string, unknown> | undefined) ?? {};
  const requestedPlan =
    typeof billing.requestedPlan === "string" ? billing.requestedPlan : null;

  if (!requestedPlan || !ALLOWED_PAID_PLANS.has(requestedPlan)) {
    return { error: "Nenhuma solicitação pendente válida para aprovação" };
  }

  if (decision === "approve") {
    await db
      .update(organizations)
      .set({
        plan: requestedPlan,
        settings: {
          ...settings,
          billing: {
            ...billing,
            status: "active",
            approvedAt: new Date().toISOString(),
            reviewedAt: new Date().toISOString(),
            reviewDecision: "approved",
            requestedPlan: null,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));
  } else {
    await db
      .update(organizations)
      .set({
        plan: "none",
        settings: {
          ...settings,
          billing: {
            ...billing,
            status: "rejected",
            reviewedAt: new Date().toISOString(),
            reviewDecision: "rejected",
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/admin/usuarios");
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
          requestedPlan: null,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));

  revalidatePath("/dashboard/admin/usuarios");
  revalidatePath("/dashboard");
  return { success: true };
}
