import { eq, gte, desc } from "drizzle-orm";
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

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Admin - Fluxo de Atendimento</h1>
        <p className="mt-1 text-slate-500">
          Visão administrativa do fluxo da IA para entender triagem, catálogo, reserva e handoff.
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-medium text-slate-900">Fluxo Atual (resumo)</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Saudação inicial e identificação de nome</li>
          <li>Descoberta da dúvida (orçamento x agendamento)</li>
          <li>Qualificação de óleo/veículo e busca em produtos/serviços</li>
          <li>Confirmação de veículo salvo quando aplicável</li>
          <li>Handoff técnico e pausa de IA quando necessário</li>
          <li>Coleta de dados para reserva e confirmação final</li>
        </ol>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-medium text-slate-900">Top stages (24h)</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {summary.stages.length === 0 ? (
              <li>Nenhum dado nas últimas 24h.</li>
            ) : (
              summary.stages.map(([key, count]) => (
                <li key={key} className="flex items-center justify-between">
                  <span className="font-mono text-xs">{key}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{count}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-medium text-slate-900">Top decision codes (24h)</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {summary.codes.length === 0 ? (
              <li>Nenhum dado nas últimas 24h.</li>
            ) : (
              summary.codes.map(([key, count]) => (
                <li key={key} className="flex items-center justify-between">
                  <span className="font-mono text-xs">{key}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{count}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
