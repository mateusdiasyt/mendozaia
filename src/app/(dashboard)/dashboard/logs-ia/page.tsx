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
            Eventos de orquestração para diagnosticar decisões e consultas de reservas.
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
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Decision</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Reason</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Conversa</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Estados</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nenhum log encontrado para esta organização.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{log.event}</td>
                    <td className="px-4 py-3 text-slate-700">{log.decision ?? "-"}</td>
                    <td className="max-w-[260px] px-4 py-3 text-slate-700">{log.reason ?? "-"}</td>
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
                        {renderMetadata((log.metadata as LogMetadata) ?? null)}
                      </pre>
                    </td>
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
