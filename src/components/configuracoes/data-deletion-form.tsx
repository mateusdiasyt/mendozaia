"use client";

import { useMemo, useState, useTransition } from "react";
import type { DeleteDataScope } from "@/app/actions/organization";
import { deleteOrganizationData } from "@/app/actions/organization";
import { AlertTriangle } from "lucide-react";

export function DataDeletionForm() {
  const [scope, setScope] = useState<DeleteDataScope>("conversations_only");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const confirmText = useMemo(() => {
    if (scope === "conversations_and_contacts") {
      return "Tem certeza que deseja deletar todas as conversas e todos os contatos?";
    }
    return "Tem certeza que deseja deletar todas as conversas?";
  }, [scope]);

  function handleDelete() {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await deleteOrganizationData(scope);

      if (!result || ("error" in result && result.error)) {
        setError(result?.error ?? "Nao foi possivel deletar os dados.");
        return;
      }

      const deletedConversations = result.deletedConversations ?? 0;
      const deletedContacts = result.deletedContacts ?? 0;
      setSuccess(
        scope === "conversations_and_contacts"
          ? `${deletedConversations} conversa(s) e ${deletedContacts} contato(s) removidos.`
          : `${deletedConversations} conversa(s) removida(s).`
      );
      setConfirmOpen(false);
    });
  }

  return (
    <>
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-red-100 p-2 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-red-800">Deletar dados</h3>
            <p className="mt-1 text-xs text-red-700">
              Esta acao e irreversivel. Escolha o que deseja apagar da organizacao.
            </p>

            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="delete-data-scope"
                  value="conversations_only"
                  checked={scope === "conversations_only"}
                  onChange={() => setScope("conversations_only")}
                  className="h-4 w-4 accent-red-600"
                />
                So conversas
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="delete-data-scope"
                  value="conversations_and_contacts"
                  checked={scope === "conversations_and_contacts"}
                  onChange={() => setScope("conversations_and_contacts")}
                  className="h-4 w-4 accent-red-600"
                />
                Conversas e contatos
              </label>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  setConfirmOpen(true);
                }}
                disabled={isPending}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Deletar dados
              </button>
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-700">
                {success}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar exclusao</h3>
            <p className="mt-2 text-sm text-slate-600">{confirmText}</p>
            <p className="mt-2 text-xs text-slate-500">
              Nao existe recuperacao automatica depois da exclusao.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isPending) return;
                  setConfirmOpen(false);
                }}
                disabled={isPending}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                {isPending ? "Deletando..." : "Sim, deletar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

