import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { orchestrationLogs } from "@/lib/db/schema";

type LogMetadata = Record<string, unknown> | null;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function renderMetadata(metadata: LogMetadata): string {
  if (!metadata) return "-";
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return "[metadata inválido]";
  }
}

function getMetaString(metadata: LogMetadata, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function getMetaNumber(metadata: LogMetadata, key: string): number | null {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function shortId(value: string | null, size = 8): string {
  if (!value) return "-";
  return value.slice(0, size);
}

function durationLabel(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function decisionBadgeClass(decision: string | null): string {
  if (!decision) return "bg-slate-100 text-slate-700";
  if (decision === "tool_then_ai" || decision === "ai_respond") return "bg-emerald-100 text-emerald-700";
  if (decision === "automation_only") return "bg-indigo-100 text-indigo-700";
  if (decision === "human_only") return "bg-amber-100 text-amber-700";
  if (decision === "silence") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

export default async function LogsIAPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const logs = await db
    .select({
      id: orchestrationLogs.id,
      conversationId: orchestrationLogs.conversationId,
      event: orchestrationLogs.event,
      decision: orchestrationLogs.decision,
      reason: orchestrationLogs.reason,
      stateBefore: orchestrationLogs.stateBefore,
      stateAfter: orchestrationLogs.stateAfter,
      metadata: orchestrationLogs.metadata,
      createdAt: orchestrationLogs.createdAt,
    })
    .from(orchestrationLogs)
    .where(eq(orchestrationLogs.organizationId, org.id))
    .orderBy(desc(orchestrationLogs.createdAt))
    .limit(200);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Logs IA (temporário)</h1>
          <p className="mt-1 text-slate-500">
            Timeline técnica da mensagem: webhook → automação → orquestrador → IA/ferramentas.
          </p>
        </div>
        <Link
          href="/dashboard/logs-ia"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Atualizar
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[75vh] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Data/Hora</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Evento</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Trace</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Código</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Decision</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Reason</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Duração</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Conversa</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Estados</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    Nenhum log encontrado para esta organização.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="align-top">
                    {(() => {
                      const metadata = (log.metadata as LogMetadata) ?? null;
                      const traceId = getMetaString(metadata, "traceId");
                      const decisionCode = getMetaString(metadata, "decisionCode");
                      const durationMs = getMetaNumber(metadata, "durationMs");
                      return (
                        <>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{log.event}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {shortId(traceId, 10)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {decisionCode ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${decisionBadgeClass(
                          log.decision ?? null
                        )}`}
                      >
                        {log.decision ?? "-"}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-4 py-3 text-slate-700">{log.reason ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                      {durationLabel(durationMs)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{log.conversationId}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="text-xs">
                        <div>
                          <span className="font-medium">Antes:</span> {log.stateBefore ?? "-"}
                        </div>
                        <div>
                          <span className="font-medium">Depois:</span> {log.stateAfter ?? "-"}
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[420px] px-4 py-3">
                      <pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs text-slate-700">
                        {renderMetadata(metadata)}
                      </pre>
                    </td>
                        </>
                      );
                    })()}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
