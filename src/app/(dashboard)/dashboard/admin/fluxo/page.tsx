import { eq, desc } from "drizzle-orm";
import { getCurrentMembership } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { orchestrationLogs } from "@/lib/db/schema";

type LogRow = {
  stage: string | null;
  decisionCode: string | null;
  createdAt: Date;
};

function getDecisionCode(metadata: unknown): string | null {
  const m = (metadata as Record<string, unknown> | null) ?? null;
  const code = m?.decisionCode;
  return typeof code === "string" ? code : null;
}

function getStage(metadata: unknown): string | null {
  const m = (metadata as Record<string, unknown> | null) ?? null;
  const stage = m?.stage;
  return typeof stage === "string" ? stage : null;
}

function summarize(rows: LogRow[]) {
  const byStage = new Map<string, number>();
  const byCode = new Map<string, number>();
  for (const row of rows) {
    if (row.stage) byStage.set(row.stage, (byStage.get(row.stage) ?? 0) + 1);
    if (row.decisionCode) byCode.set(row.decisionCode, (byCode.get(row.decisionCode) ?? 0) + 1);
  }
  return {
    stages: [...byStage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    codes: [...byCode.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

function formatStageLabel(stage: string): string {
  if (stage === "orchestrator.profile") return "Perfil";
  if (stage === "orchestrator.catalog") return "Catálogo";
  if (stage === "orchestrator.reservations") return "Reservas";
  if (stage === "orchestrator.decision") return "Decisão";
  if (stage === "automation.engine") return "Automação";
  if (stage === "webhook.inbound") return "Webhook";
  return stage;
}

function formatCodeLabel(code: string): string {
  return code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function percent(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export default async function AdminFluxoPage() {
  const membership = await getCurrentMembership();
  if (!membership) return null;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const raw = await db
    .select({
      metadata: orchestrationLogs.metadata,
      createdAt: orchestrationLogs.createdAt,
    })
    .from(orchestrationLogs)
    .where(
      eq(orchestrationLogs.organizationId, membership.organization.id)
    )
    .orderBy(desc(orchestrationLogs.createdAt))
    .limit(400);

  const last24h = raw
    .filter((r) => r.createdAt >= since)
    .map((r) => ({
      stage: getStage(r.metadata),
      decisionCode: getDecisionCode(r.metadata),
      createdAt: r.createdAt,
    }));

  const summary = summarize(last24h);
  const totalEvents = last24h.length;
  const uniqueStages = new Set(last24h.map((r) => r.stage).filter(Boolean)).size;
  const uniqueCodes = new Set(last24h.map((r) => r.decisionCode).filter(Boolean)).size;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Admin - Fluxo de Atendimento</h1>
        <p className="mt-1 text-slate-500">
          Visão administrativa do fluxo da IA para entender triagem, catálogo, reserva e handoff.
        </p>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Eventos (24h)</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalEvents}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Etapas ativas</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{uniqueStages}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Decisões distintas</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{uniqueCodes}</p>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-medium text-slate-900">Fluxo Atual (resumo)</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            "1. Identificação de nome",
            "2. Triagem de intenção",
            "3. Qualificação do problema",
            "4. Consulta em catálogo",
            "5. Reserva ou handoff técnico",
            "6. Confirmação final",
          ].map((step) => (
            <div
              key={step}
              className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              {step}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-medium text-slate-900">Top stages (24h)</h3>
          <ul className="mt-3 space-y-3 text-sm text-slate-700">
            {summary.stages.length === 0 ? (
              <li>Nenhum dado nas últimas 24h.</li>
            ) : (
              summary.stages.map(([key, count]) => (
                <li key={key}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{formatStageLabel(key)}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-indigo-500"
                      style={{ width: `${percent(count, totalEvents)}%` }}
                    />
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-medium text-slate-900">Top decision codes (24h)</h3>
          <ul className="mt-3 space-y-3 text-sm text-slate-700">
            {summary.codes.length === 0 ? (
              <li>Nenhum dado nas últimas 24h.</li>
            ) : (
              summary.codes.map(([key, count]) => (
                <li key={key}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{formatCodeLabel(key)}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{ width: `${percent(count, totalEvents)}%` }}
                    />
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
