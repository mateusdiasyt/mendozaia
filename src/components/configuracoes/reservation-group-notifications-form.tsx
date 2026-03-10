"use client";

import { useMemo, useState } from "react";
import {
  sendReservationGroupNotificationsTest,
  updateReservationGroupNotificationsConfig,
} from "@/app/actions/organization";
import { Loader2, Save, Send, CheckCircle2 } from "lucide-react";

interface ReservationGroupNotificationsFormProps {
  initialConfig: {
    enabled: boolean;
    groupId: string;
    detectedGroupIds: string[];
  };
}

export function ReservationGroupNotificationsForm({
  initialConfig,
}: ReservationGroupNotificationsFormProps) {
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [groupId, setGroupId] = useState(initialConfig.groupId);
  const [detectedGroupIds, setDetectedGroupIds] = useState(
    initialConfig.detectedGroupIds
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const uniqueDetected = useMemo(
    () => Array.from(new Set(detectedGroupIds)),
    [detectedGroupIds]
  );

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await updateReservationGroupNotificationsConfig({
      enabled,
      groupId,
      detectedGroupIds: uniqueDetected,
    });
    setSaving(false);

    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }

    if (result?.config) {
      setEnabled(result.config.enabled);
      setGroupId(result.config.groupId ?? "");
      setDetectedGroupIds(result.config.detectedGroupIds ?? []);
    }
    setMessage({ type: "success", text: "Configuracao salva com sucesso." });
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    const preSave = await updateReservationGroupNotificationsConfig({
      enabled,
      groupId,
      detectedGroupIds: uniqueDetected,
    });
    if (preSave?.error) {
      setTesting(false);
      setMessage({ type: "error", text: preSave.error });
      return;
    }

    if (preSave?.config) {
      setEnabled(preSave.config.enabled);
      setGroupId(preSave.config.groupId ?? "");
      setDetectedGroupIds(preSave.config.detectedGroupIds ?? []);
    }

    const result = await sendReservationGroupNotificationsTest();
    setTesting(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({
      type: "success",
      text: "Mensagem de teste enviada para o grupo configurado.",
    });
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            Notificacao de agendamento no grupo
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Quando uma reserva for criada, enviamos a lista de agendamentos do
            dia no grupo informado.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Ativar
        </label>
      </div>

      {message ? (
        <div
          className={`mt-3 rounded-xl px-3 py-2 text-xs ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="mt-4">
        <label className="text-xs font-medium text-slate-700">
          ID do grupo (WhatsApp)
        </label>
        <input
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
          className={inputClass}
          placeholder="Ex.: 120363xxxxxxxx@g.us"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Pode colar direto com <code>@g.us</code>. Se ja detectar grupos,
          clique em usar abaixo.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || testing}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Salvar grupo
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={saving || testing}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Enviar teste
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-slate-700">
          Grupos detectados automaticamente
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Envie qualquer mensagem no grupo com o WhatsApp conectado para ele
          aparecer aqui.
        </p>

        {uniqueDetected.length > 0 ? (
          <div className="mt-3 space-y-2">
            {uniqueDetected.map((detected) => {
              const selected = groupId.trim() === detected;
              return (
                <div
                  key={detected}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <span className="truncate text-xs text-slate-700">
                    {detected}
                  </span>
                  <button
                    type="button"
                    onClick={() => setGroupId(detected)}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                      selected
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    }`}
                  >
                    {selected ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Selecionado
                      </>
                    ) : (
                      "Usar este grupo"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            Nenhum grupo detectado ainda.
          </p>
        )}
      </div>
    </div>
  );
}
