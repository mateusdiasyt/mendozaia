import { auth } from "@/auth";
import Link from "next/link";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { AiAgentForm } from "./ai-agent-form";
import { ReservationsToggle } from "@/components/configuracoes/reservations-toggle";
import { ReservationScheduleForm } from "@/components/configuracoes/reservation-schedule-form";
import { BusinessProfileForm } from "@/components/configuracoes/business-profile-form";
import { BotPersonalizationForm } from "@/components/configuracoes/bot-personalization-form";
import { VehicleServicePolicyForm } from "@/components/configuracoes/vehicle-service-policy-form";
import { OfferedServicesForm } from "@/components/configuracoes/offered-services-form";
import { ReservationGroupNotificationsForm } from "@/components/configuracoes/reservation-group-notifications-form";
import { DataDeletionForm } from "@/components/configuracoes/data-deletion-form";
import { AccountSecurityForm } from "@/components/configuracoes/account-security-form";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { parseReservationGroupNotifications } from "@/lib/whatsapp-group-notifications";

type SettingsSection =
  | "geral"
  | "plugins"
  | "bot"
  | "veiculos"
  | "servicos"
  | "agenda";

const SETTINGS_MENU: Array<{ key: SettingsSection; label: string }> = [
  { key: "geral", label: "Geral" },
  { key: "plugins", label: "Plugins" },
  { key: "bot", label: "Configuracoes do bot" },
  { key: "veiculos", label: "Veiculos" },
  { key: "servicos", label: "Servicos" },
  { key: "agenda", label: "Agenda" },
];

function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_MENU.some((item) => item.key === value);
}

type SearchParamsInput =
  | Record<string, string | string[] | undefined>
  | Promise<Record<string, string | string[] | undefined>>;

async function resolveSearchParams(
  input: SearchParamsInput | undefined
): Promise<Record<string, string | string[] | undefined>> {
  if (!input) return {};
  if ("then" in input && typeof input.then === "function") {
    return input;
  }
  return input;
}

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const session = await auth();
  const org = await getCurrentOrganization();
  if (!org) return null;

  const resolvedSearchParams = await resolveSearchParams(searchParams);
  const requestedSectionRaw =
    typeof resolvedSearchParams.sec === "string" ? resolvedSearchParams.sec : "geral";
  const requestedSection =
    requestedSectionRaw === "reservas"
      ? "plugins"
      : requestedSectionRaw === "perfil" || requestedSectionRaw === "ia"
        ? "bot"
        : requestedSectionRaw;
  const activeSection: SettingsSection = isSettingsSection(requestedSection)
    ? requestedSection
    : "geral";

  const settings = (org.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};
  const businessProfile =
    (settings.businessProfile as Record<string, unknown> | undefined) ?? {};
  const botConfig = (settings.botConfig as Record<string, unknown> | undefined) ?? {};
  const offeredServicesConfig =
    (settings.offeredServicesConfig as Record<string, unknown> | undefined) ?? {};
  const vehicleServicePolicy =
    (settings.vehicleServicePolicy as Record<string, unknown> | undefined) ?? {};
  const reservationsEnabled = !!settings.reservationsEnabled;
  const reservationGroupNotifications = parseReservationGroupNotifications(
    settings.reservationGroupNotifications
  );
  const reservationSchedule =
    (settings.reservationSchedule as Record<string, unknown> | undefined) ?? {};
  const businessHours =
    (settings.businessHours as Record<string, unknown> | undefined) ?? {};
  const scheduleStart =
    (reservationSchedule.start as string | undefined) ||
    (businessHours.start as string | undefined) ||
    "09:00";
  const scheduleEnd =
    (reservationSchedule.end as string | undefined) ||
    (businessHours.end as string | undefined) ||
    "17:00";
  const scheduleTimezone =
    (reservationSchedule.timezone as string | undefined) ||
    (businessHours.timezone as string | undefined) ||
    "America/Sao_Paulo";
  const scheduleLunchBreakStart =
    (reservationSchedule.lunchBreakStart as string | undefined) || "12:00";
  const scheduleLunchBreakEnd =
    (reservationSchedule.lunchBreakEnd as string | undefined) || "13:00";
  const scheduleSaturdayEnd =
    (reservationSchedule.saturdayEnd as string | undefined) || "12:00";
  const scheduleWorkingDays = Array.isArray(reservationSchedule.workingDays)
    ? (reservationSchedule.workingDays as number[])
    : [1, 2, 3, 4, 5];
  const scheduleBlockedDates = Array.isArray(reservationSchedule.blockedDates)
    ? (reservationSchedule.blockedDates as string[])
    : [];
  const isPlanActive = org.plan !== "free" && org.plan !== "none";
  const planLabel =
    org.plan === "free" || org.plan === "none"
      ? "Sem plano ativo"
      : org.plan === "starter"
        ? "Starter"
        : org.plan === "pro"
          ? "Pro"
          : org.plan === "scale"
            ? "Scale"
            : org.plan;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Configuracoes</h1>
        <p className="mt-1 text-slate-500">Gerencie sua conta e organizacao</p>
      </div>

      {!isPlanActive && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Seu plano ainda nao esta ativo. As configuracoes estao visiveis, mas bloqueadas com
          cadeado ate a liberacao do pagamento.
        </div>
      )}

      <div className="mb-6 overflow-x-auto pb-1">
        <div className="inline-flex min-w-full gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {SETTINGS_MENU.map((item) => {
            const active = item.key === activeSection;
            return (
              <Link
                key={item.key}
                href={`/dashboard/configuracoes?sec=${item.key}`}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="max-w-5xl">
        {activeSection === "geral" && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <SectionCard>
              <h3 className="font-medium text-slate-900">Sua conta</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Nome</dt>
                  <dd className="font-medium text-slate-900">{session?.user?.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd className="font-medium text-slate-900">{session?.user?.email}</dd>
                </div>
              </dl>
              <AccountSecurityForm currentEmail={session?.user?.email ?? ""} />
            </SectionCard>

            <SectionCard>
              <h3 className="font-medium text-slate-900">Organizacao</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Nome</dt>
                  <dd className="font-medium text-slate-900">{org.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Plano</dt>
                  <dd className="font-medium text-slate-900">{planLabel}</dd>
                </div>
              </dl>
            </SectionCard>

            <SectionCard className="md:col-span-2">
              <DataDeletionForm />
            </SectionCard>
          </div>
        )}

        {activeSection === "plugins" && (
          <SectionCard className="relative">
            <div className="space-y-6">
              <ReservationsToggle initialEnabled={reservationsEnabled} />
              <ReservationGroupNotificationsForm
                initialConfig={{
                  enabled: reservationGroupNotifications.enabled,
                  groupId: reservationGroupNotifications.groupId ?? "",
                  detectedGroupIds:
                    reservationGroupNotifications.detectedGroupIds ?? [],
                }}
              />
            </div>
            {!isPlanActive && <LockedOverlay />}
          </SectionCard>
        )}

        {activeSection === "bot" && (
          <div className="space-y-6">
            <SectionCard className="relative">
              <BotPersonalizationForm
                initialConfig={{
                  segment:
                    (botConfig.segment as "mecanica" | "restaurante" | "geral" | undefined) ??
                    "mecanica",
                  tone:
                    (botConfig.tone as "formal" | "neutro" | "casual" | undefined) ??
                    "neutro",
                  language: (botConfig.language as string | undefined) ?? "pt-BR",
                  useAIFallback: aiAgent.useAsFallback !== false,
                }}
              />
              {!isPlanActive && <LockedOverlay />}
            </SectionCard>

            <SectionCard className="relative">
              <BusinessProfileForm
                initialConfig={{
                  botName: (businessProfile.botName as string | undefined) ?? "",
                  instagram: (businessProfile.instagram as string | undefined) ?? "",
                  address: (businessProfile.address as string | undefined) ?? "",
                  mapsLink: (businessProfile.mapsLink as string | undefined) ?? "",
                  about: (businessProfile.about as string | undefined) ?? "",
                }}
              />
              {!isPlanActive && <LockedOverlay />}
            </SectionCard>

            <SectionCard className="relative">
              <AiAgentForm
                initialConfig={{
                  enabled: aiAgent.enabled as boolean | undefined,
                  useAsFallback: aiAgent.useAsFallback as boolean | undefined,
                  systemPrompt: aiAgent.systemPrompt as string | undefined,
                  model: aiAgent.model as string | undefined,
                  hasApiKey: !!(aiAgent.apiKey && String(aiAgent.apiKey).trim()),
                }}
              />
              {!isPlanActive && <LockedOverlay />}
            </SectionCard>
          </div>
        )}

        {activeSection === "veiculos" && (
          <SectionCard className="relative">
            <VehicleServicePolicyForm
              initialConfig={{
                minAllowedYear:
                  typeof vehicleServicePolicy.minAllowedYear === "number"
                    ? vehicleServicePolicy.minAllowedYear
                    : null,
                supportedModels: Array.isArray(vehicleServicePolicy.supportedModels)
                  ? (vehicleServicePolicy.supportedModels as string[])
                  : [],
                blockedModels: Array.isArray(vehicleServicePolicy.blockedModels)
                  ? (vehicleServicePolicy.blockedModels as string[])
                  : [],
              }}
            />
            {!isPlanActive && <LockedOverlay />}
          </SectionCard>
        )}

        {activeSection === "servicos" && (
          <SectionCard className="relative">
            <OfferedServicesForm
              initialSelectedServices={Array.isArray(offeredServicesConfig.selectedServices)
                ? (offeredServicesConfig.selectedServices as string[])
                : []}
            />
            {!isPlanActive && <LockedOverlay />}
          </SectionCard>
        )}

        {activeSection === "agenda" && (
          <SectionCard className="relative">
            <ReservationScheduleForm
              initialConfig={{
                start: scheduleStart,
                end: scheduleEnd,
                timezone: scheduleTimezone,
                workingDays: scheduleWorkingDays,
                blockedDates: scheduleBlockedDates,
                lunchBreakStart: scheduleLunchBreakStart,
                lunchBreakEnd: scheduleLunchBreakEnd,
                saturdayEnd: scheduleSaturdayEnd,
              }}
            />
            {!isPlanActive && <LockedOverlay />}
          </SectionCard>
        )}

      </div>
    </div>
  );
}

function SectionCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/75 backdrop-blur-[1px]">
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
        <Lock className="h-3.5 w-3.5" />
        Plano nao ativo
      </div>
    </div>
  );
}
