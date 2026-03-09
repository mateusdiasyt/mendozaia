"use client";

import { useState } from "react";
import { FileText, Loader2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getConversationOrchestrationLogs,
  resetConversationForTesting,
} from "@/app/actions/messages";

interface ConversationHeaderActionsProps {
  conversationId: string;
}

interface ConversationLogItem {
  id: string;
  event: string;
  decision: string | null;
  reason: string | null;
  stateBefore: string | null;
  stateAfter: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function ConversationHeaderActions({
  conversationId,
}: ConversationHeaderActionsProps) {
  const router = useRouter();
  const [loadingReset, setLoadingReset] = useState(false);
  const [openResetConfirm, setOpenResetConfirm] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [conversationLogs, setConversationLogs] = useState<ConversationLogItem[]>([]);

  async function handleResetConversation() {
    setLoadingReset(true);
    try {
      await resetConversationForTesting(conversationId);
      setOpenResetConfirm(false);
      router.push("/dashboard/conversas");
      router.refresh();
    } catch {
      // noop
    } finally {
      setLoadingReset(false);
    }
  }

  async function handleOpenLogs() {
    setIsLogsOpen(true);
    setLogsLoading(true);
    setLogsError(null);
    try {
      const logs = await getConversationOrchestrationLogs(conversationId);
      setConversationLogs(logs);
    } catch {
      setLogsError("Não foi possível carregar os logs desta conversa.");
    } finally {
      setLogsLoading(false);
    }
  }

  function formatLogDate(dateString: string): string {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(dateString));
  }

  function getMetadataString(metadata: Record<string, unknown> | null): string {
    if (!metadata) return "-";
    try {
      return JSON.stringify(metadata, null, 2);
    } catch {
      return "-";
    }
  }

  function getMetadataValue(
    metadata: Record<string, unknown> | null,
    key: string
  ): string {
    if (!metadata) return "-";
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "-";
  }

  function decisionClass(decision: string | null): string {
    if (!decision) return "bg-slate-100 text-slate-700";
    if (decision === "tool_then_ai" || decision === "ai_respond") {
      return "bg-emerald-100 text-emerald-700";
    }
    if (decision === "automation_only") return "bg-indigo-100 text-indigo-700";
    if (decision === "human_only") return "bg-amber-100 text-amber-700";
    if (decision === "silence") return "bg-rose-100 text-rose-700";
    return "bg-slate-100 text-slate-700";
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenResetConfirm(true)}
        title="Resetar conversa"
        aria-label="Resetar conversa"
        className="rounded-full p-2.5 text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-deep)]"
      >
        <Trash2 className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={handleOpenLogs}
        title="Logs da IA"
        aria-label="Logs da IA"
        className="rounded-full p-2.5 text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-deep)]"
      >
        <FileText className="h-5 w-5" />
      </button>

      {openResetConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#6C6C94]/40 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-[#131047]">Resetar conversa</h3>
            <p className="mt-2 text-sm text-[#6C6C94]">
              Isso vai apagar contato, conversa e mensagens deste número para testes. Deseja continuar?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (loadingReset) return;
                  setOpenResetConfirm(false);
                }}
                disabled={loadingReset}
                className="rounded-xl border border-[#C8CCE5] px-4 py-2 text-sm font-medium text-[#131047] hover:bg-[#F4F5FF] disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleResetConversation}
                disabled={loadingReset}
                className="rounded-xl bg-[#131047] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {loadingReset ? "Resetando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isLogsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex h-[min(82vh,720px)] w-[min(96vw,980px)] flex-col overflow-hidden rounded-2xl border border-[var(--brand-muted)]/20 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--brand-muted)]/20 px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold text-[var(--brand-deep)]">Logs desta conversa</h4>
                <p className="text-xs text-[var(--brand-muted)]">Conversa {conversationId}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsLogsOpen(false)}
                className="rounded-lg border border-[var(--brand-muted)]/30 p-2 text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)]"
                aria-label="Fechar logs"
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--brand-surface)] p-3">
              {logsLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--brand-muted)]/20 bg-white px-3 py-2 text-sm text-[var(--brand-deep)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando logs...
                </div>
              )}

              {!logsLoading && logsError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {logsError}
                </div>
              )}

              {!logsLoading && !logsError && conversationLogs.length === 0 && (
                <div className="rounded-lg border border-[var(--brand-muted)]/20 bg-white px-3 py-2 text-sm text-[var(--brand-muted)]">
                  Nenhum log encontrado para esta conversa.
                </div>
              )}

              {!logsLoading && !logsError && conversationLogs.length > 0 && (
                <div className="space-y-2">
                  {conversationLogs.map((log) => (
                    <article key={log.id} className="rounded-lg border border-[var(--brand-muted)]/20 bg-white p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--brand-deep)]">
                          {formatLogDate(log.createdAt)}
                        </span>
                        <span className="rounded bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-deep)]">
                          {log.event}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${decisionClass(log.decision)}`}>
                          {log.decision ?? "-"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 text-xs text-[var(--brand-muted)] sm:grid-cols-2">
                        <p>
                          <span className="font-semibold text-[var(--brand-deep)]">Código:</span>{" "}
                          {getMetadataValue(log.metadata, "decisionCode")}
                        </p>
                        <p>
                          <span className="font-semibold text-[var(--brand-deep)]">Trace:</span>{" "}
                          {getMetadataValue(log.metadata, "traceId")}
                        </p>
                        <p>
                          <span className="font-semibold text-[var(--brand-deep)]">Antes:</span>{" "}
                          {log.stateBefore ?? "-"}
                        </p>
                        <p>
                          <span className="font-semibold text-[var(--brand-deep)]">Depois:</span>{" "}
                          {log.stateAfter ?? "-"}
                        </p>
                      </div>
                      {log.reason ? <p className="mt-2 text-xs text-[var(--brand-deep)]">{log.reason}</p> : null}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-muted)]">
                          Metadata
                        </summary>
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--brand-soft)] p-2 text-[11px] text-[var(--brand-deep)]">
                          {getMetadataString(log.metadata)}
                        </pre>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
