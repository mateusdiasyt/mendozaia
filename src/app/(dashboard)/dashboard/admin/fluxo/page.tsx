import { eq, desc } from "drizzle-orm";
import { getCurrentMembership } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { orchestrationLogs } from "@/lib/db/schema";

type LogRow = {
  stage: string | null;
  decisionCode: string | null;
  decision: string | null;
  event: string;
  traceId: string | null;
  createdAt: Date;
};

function getDecisionCode(metadata: unknown): string | null {
  const m = (metadata as Record<string, unknown> | null) ?? null;
  const code = m?.decisionCode;
  return typeof code === "string" ? code : null;
}

function getTraceId(metadata: unknown): string | null {
  const m = (metadata as Record<string, unknown> | null) ?? null;
  const traceId = m?.traceId;
  return typeof traceId === "string" ? traceId : null;
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

function mapLogToStep(log: LogRow): string | null {
  const code = log.decisionCode ?? "";
  const stage = log.stage ?? "";
  const event = log.event;
  const decision = log.decision ?? "";

  if (event === "webhook_inbound_received" || code === "WEBHOOK_INBOUND_RECEIVED") {
    return "Entrada";
  }
  if (
    event === "intake_greeting" ||
    event === "intake_name_captured" ||
    code === "INTAKE_GREETING" ||
    code === "INTAKE_NAME_CAPTURED"
  ) {
    return "Identificação";
  }
  if (
    code.startsWith("INTAKE_") &&
    !code.includes("NAME")
  ) {
    return "Triagem";
  }
  if (stage === "orchestrator.catalog") {
    return "Catálogo";
  }
  if (stage === "orchestrator.reservations") {
    return "Reserva";
  }
  if (
    decision === "human_only" ||
    code.includes("HANDOFF") ||
    event.includes("handoff")
  ) {
    return "Handoff Técnico";
  }
  if (code === "RESERVATION_CONFIRMED") {
    return "Reserva Confirmada";
  }
  if (decision === "silence" || code.includes("SILENCE")) {
    return "Falha/Silêncio";
  }
  return null;
}

function buildTransitions(rows: LogRow[]) {
  const byTrace = new Map<string, LogRow[]>();
  for (const row of rows) {
    if (!row.traceId) continue;
    const arr = byTrace.get(row.traceId) ?? [];
    arr.push(row);
    byTrace.set(row.traceId, arr);
  }

  const nodeCounts = new Map<string, number>();
  const transitionCounts = new Map<string, number>();

  for (const logs of byTrace.values()) {
    logs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const steps = logs
      .map(mapLogToStep)
      .filter((v): v is string => !!v);
    const compactSteps: string[] = [];
    for (const step of steps) {
      if (compactSteps[compactSteps.length - 1] !== step) compactSteps.push(step);
    }

    for (const step of compactSteps) {
      nodeCounts.set(step, (nodeCounts.get(step) ?? 0) + 1);
    }
    for (let i = 0; i < compactSteps.length - 1; i++) {
      const key = `${compactSteps[i]}->${compactSteps[i + 1]}`;
      transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);
    }
  }

  const topTransitions = [...transitionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  return { nodeCounts, transitionCounts, topTransitions };
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
      event: orchestrationLogs.event,
      decision: orchestrationLogs.decision,
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
      traceId: getTraceId(r.metadata),
      event: r.event,
      decision: r.decision,
      createdAt: r.createdAt,
    }));

  const summary = summarize(last24h);
  const flow = buildTransitions(last24h);
  const totalEvents = last24h.length;
  const uniqueStages = new Set(last24h.map((r) => r.stage).filter(Boolean)).size;
  const uniqueCodes = new Set(last24h.map((r) => r.decisionCode).filter(Boolean)).size;
  const flowNodes = [
    "Entrada",
    "Identificação",
    "Triagem",
    "Catálogo",
    "Reserva",
    "Handoff Técnico",
    "Reserva Confirmada",
    "Falha/Silêncio",
  ];
  const flowEdge = (from: string, to: string) =>
    flow.transitionCounts.get(`${from}->${to}`) ?? 0;

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

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-medium text-slate-900">Mapa visual do fluxo (24h)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Caminho percorrido pela conversa com contagem real de entradas por etapa e transições.
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {flowNodes.map((node) => (
            <div
              key={node}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="text-sm font-medium text-slate-800">{node}</div>
              <div className="mt-1 text-xs text-slate-500">
                {flow.nodeCounts.get(node) ?? 0} conversas
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ["Entrada", "Identificação"],
            ["Identificação", "Triagem"],
            ["Triagem", "Catálogo"],
            ["Catálogo", "Reserva"],
            ["Catálogo", "Handoff Técnico"],
            ["Reserva", "Reserva Confirmada"],
            ["Reserva", "Handoff Técnico"],
            ["Triagem", "Falha/Silêncio"],
          ].map(([from, to]) => (
            <div
              key={`${from}-${to}`}
              className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-700"
            >
              <span className="font-medium">{from}</span>
              <span className="mx-1">→</span>
              <span className="font-medium">{to}</span>
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5">
                {flowEdge(from, to)}
              </span>
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

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-medium text-slate-900">Top transições (24h)</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {flow.topTransitions.length === 0 ? (
            <li>Nenhuma transição registrada com trace nas últimas 24h.</li>
          ) : (
            flow.topTransitions.map(([key, count]) => {
              const [from, to] = key.split("->");
              return (
                <li key={key} className="flex items-center justify-between">
                  <span>
                    <span className="font-medium">{from}</span>
                    <span className="mx-1">→</span>
                    <span className="font-medium">{to}</span>
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{count}</span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
