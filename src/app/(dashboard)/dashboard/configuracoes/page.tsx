import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { AiAgentForm } from "./ai-agent-form";
import { ReservationsToggle } from "@/components/configuracoes/reservations-toggle";
import { ReservationScheduleForm } from "@/components/configuracoes/reservation-schedule-form";
import { BusinessProfileForm } from "@/components/configuracoes/business-profile-form";
import { BotPersonalizationForm } from "@/components/configuracoes/bot-personalization-form";
import { VehicleServicePolicyForm } from "@/components/configuracoes/vehicle-service-policy-form";
import { OfferedServicesForm } from "@/components/configuracoes/offered-services-form";
import { Lock } from "lucide-react";

export default async function ConfiguracoesPage() {
  const session = await auth();
  const org = await getCurrentOrganization();
  if (!org) return null;

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
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Configurações</h1>
        <p className="mt-1 text-slate-500">
          Gerencie sua conta e organização
        </p>
      </div>

      <div className="space-y-6 max-w-2xl">
        {!isPlanActive && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Seu plano ainda não está ativo. As configurações estão visíveis, mas bloqueadas com
            cadeado até a liberação do pagamento.
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">Organização</h3>
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
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ReservationsToggle initialEnabled={reservationsEnabled} />
          {!isPlanActive && <LockedOverlay />}
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <VehicleServicePolicyForm
            initialConfig={{
              minAllowedYear:
                typeof vehicleServicePolicy.minAllowedYear === "number"
                  ? vehicleServicePolicy.minAllowedYear
                  : null,
              blockedModels: Array.isArray(vehicleServicePolicy.blockedModels)
                ? (vehicleServicePolicy.blockedModels as string[])
                : [],
              blockedModelYears: Array.isArray(vehicleServicePolicy.blockedModelYears)
                ? ((vehicleServicePolicy.blockedModelYears as Array<Record<string, unknown>>)
                    .map((item) => ({
                      model: String(item.model ?? "").trim().toLowerCase(),
                      year:
                        typeof item.year === "number" && Number.isFinite(item.year)
                          ? item.year
                          : null,
                    }))
                    .filter((item) => item.model.length >= 2))
                : [],
            }}
          />
          {!isPlanActive && <LockedOverlay />}
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <OfferedServicesForm
            initialSelectedServices={Array.isArray(offeredServicesConfig.selectedServices)
              ? (offeredServicesConfig.selectedServices as string[])
              : []}
          />
          {!isPlanActive && <LockedOverlay />}
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ReservationScheduleForm
            initialConfig={{
              start: scheduleStart,
              end: scheduleEnd,
              timezone: scheduleTimezone,
              workingDays: scheduleWorkingDays,
              blockedDates: scheduleBlockedDates,
            }}
          />
          {!isPlanActive && <LockedOverlay />}
        </div>

        <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
        </div>
      </div>
    </div>
  );
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/75 backdrop-blur-[1px]">
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
        <Lock className="h-3.5 w-3.5" />
        Plano não ativo
      </div>
    </div>
  );
}
