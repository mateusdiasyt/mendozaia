"use client";

import { useMemo, useState } from "react";
import {
  sendReservationGroupNotificationsTest,
  updateReservationGroupNotificationsConfig,
} from "@/app/actions/organization";
import {
  Loader2,
  Save,
  Send,
  CheckCircle2,
  MessageCircle,
  Sparkles,
  Link2,
} from "lucide-react";

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
    "mt-2 block w-full rounded-xl border border-[var(--brand-muted)]/20 bg-white px-4 py-3 text-[var(--brand-deep)] placeholder-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
      <article className="relative overflow-hidden rounded-3xl border border-[var(--brand-primary)]/25 bg-[var(--brand-deep)] p-5 text-white shadow-[0_16px_40px_-20px_rgba(19,16,71,0.9)]">
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
          <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
          <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/5" />
        </div>
        <div className="relative z-10">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/30 bg-white">
              <MessageCircle className="h-5 w-5 text-[var(--brand-deep)]/80" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold">
              <span
                className={`h-2 w-2 rounded-full ${
                  enabled ? "bg-emerald-400" : "bg-slate-300"
                }`}
              />
              {enabled ? "Ativo" : "Desativado"}
            </span>
          </div>

          <h4 className="text-lg font-semibold leading-tight">
            Notificação de agendamentos
          </h4>
          <p className="mt-2 text-sm text-white/80">
            Cada reserva confirmada envia no grupo a lista completa do dia.
          </p>

          <div className="mt-4 rounded-xl border border-white/15 bg-white/10 p-3 text-xs text-white/85">
            <p className="font-semibold">Prévia</p>
            <p className="mt-2 leading-relaxed">
              *Agendamentos de hoje*{"\n"}---------------------{"\n"}Horário:
              09:30{"\n"}Sobre: Troca de óleo{"\n"}Carro: Onix
            </p>
          </div>
        </div>
      </article>

      <div className="rounded-3xl border border-[var(--brand-muted)]/20 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--brand-deep)]">
              Configuração do grupo
            </h4>
            <p className="mt-1 text-xs text-[var(--brand-muted)]">
              Cadastre o grupo ou selecione um detectado automaticamente.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-muted)]/25 bg-[var(--brand-soft)] px-3 py-1 text-xs font-medium text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--brand-primary)] focus:ring-[var(--brand-primary)]"
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
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand-deep)]">
            <Link2 className="h-3.5 w-3.5" />
            ID do grupo (WhatsApp)
          </label>
          <input
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className={inputClass}
            placeholder="Ex.: 120363xxxxxxxx@g.us"
          />
          <p className="mt-1 text-[11px] text-[var(--brand-muted)]">
            Pode colar direto com <code>@g.us</code>.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || testing}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
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
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-muted)]/20 bg-white px-3 py-2 text-xs font-semibold text-[var(--brand-deep)] transition hover:bg-[var(--brand-soft)] disabled:opacity-60"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Enviar teste
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[var(--brand-deep)]">
              Grupos detectados automaticamente
            </p>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-primary)]/20 bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-primary)]">
              <Sparkles className="h-3 w-3" />
              {uniqueDetected.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--brand-muted)]">
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
                    className="flex items-center justify-between rounded-xl border border-[var(--brand-muted)]/20 bg-white px-3 py-2"
                  >
                    <span className="truncate text-xs text-[var(--brand-deep)]">
                      {detected}
                    </span>
                    <button
                      type="button"
                      onClick={() => setGroupId(detected)}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                        selected
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-[var(--brand-soft)] text-[var(--brand-primary)] hover:opacity-90"
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
            <p className="mt-3 text-xs text-[var(--brand-muted)]">
              Nenhum grupo detectado ainda.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
