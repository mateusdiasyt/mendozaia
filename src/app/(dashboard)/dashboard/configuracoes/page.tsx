import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { AiAgentForm } from "./ai-agent-form";
import { ReservationsToggle } from "@/components/configuracoes/reservations-toggle";
import { ReservationScheduleForm } from "@/components/configuracoes/reservation-schedule-form";
import { BusinessProfileForm } from "@/components/configuracoes/business-profile-form";
import { BotPersonalizationForm } from "@/components/configuracoes/bot-personalization-form";

export default async function ConfiguracoesPage() {
  const session = await auth();
  const org = await getCurrentOrganization();
  if (!org) return null;

  const settings = (org.settings as Record<string, unknown>) ?? {};
  const aiAgent = (settings.aiAgent as Record<string, unknown>) ?? {};
  const businessProfile =
    (settings.businessProfile as Record<string, unknown> | undefined) ?? {};
  const botConfig = (settings.botConfig as Record<string, unknown> | undefined) ?? {};
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
  const planLabel =
    org.plan === "free"
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

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ReservationsToggle initialEnabled={reservationsEnabled} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <BusinessProfileForm
            initialConfig={{
              botName: (businessProfile.botName as string | undefined) ?? "",
              instagram: (businessProfile.instagram as string | undefined) ?? "",
              address: (businessProfile.address as string | undefined) ?? "",
              mapsLink: (businessProfile.mapsLink as string | undefined) ?? "",
            }}
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ReservationScheduleForm
            initialConfig={{
              start: scheduleStart,
              end: scheduleEnd,
              timezone: scheduleTimezone,
              workingDays: scheduleWorkingDays,
              blockedDates: scheduleBlockedDates,
            }}
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <AiAgentForm
            initialConfig={{
              enabled: aiAgent.enabled as boolean | undefined,
              useAsFallback: aiAgent.useAsFallback as boolean | undefined,
              systemPrompt: aiAgent.systemPrompt as string | undefined,
              model: aiAgent.model as string | undefined,
              hasApiKey: !!(aiAgent.apiKey && String(aiAgent.apiKey).trim()),
            }}
          />
        </div>
      </div>
    </div>
  );
}
