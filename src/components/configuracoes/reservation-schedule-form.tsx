"use client";

import { useState } from "react";
import { updateReservationScheduleConfig } from "@/app/actions/organization";

interface ReservationScheduleFormProps {
  initialConfig: {
    start: string;
    end: string;
    timezone: string;
    workingDays: number[];
    blockedDates: string[];
  };
}

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

export function ReservationScheduleForm({
  initialConfig,
}: ReservationScheduleFormProps) {
  const [start, setStart] = useState(initialConfig.start);
  const [end, setEnd] = useState(initialConfig.end);
  const [timezone, setTimezone] = useState(initialConfig.timezone);
  const [workingDays, setWorkingDays] = useState<number[]>(initialConfig.workingDays);
  const [blockedDates, setBlockedDates] = useState<string[]>(
    [...new Set(initialConfig.blockedDates)].sort()
  );
  const [pendingBlockedDate, setPendingBlockedDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function toggleWorkingDay(day: number) {
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  function addBlockedDate() {
    if (!pendingBlockedDate) return;
    setBlockedDates((prev) => [...new Set([...prev, pendingBlockedDate])].sort());
    setPendingBlockedDate("");
  }

  function removeBlockedDate(date: string) {
    setBlockedDates((prev) => prev.filter((d) => d !== date));
  }

  function formatDateLabel(date: string): string {
    const [year, month, day] = date.split("-");
    if (!year || !month || !day) return date;
    return `${day}/${month}/${year}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    if (start >= end) {
      setSaving(false);
      setMessage({
        type: "error",
        text: "O horário final deve ser maior que o horário inicial.",
      });
      return;
    }

    const result = await updateReservationScheduleConfig({
      start,
      end,
      timezone: timezone.trim() || "America/Sao_Paulo",
      workingDays,
      blockedDates,
    });

    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({
      type: "success",
      text: "Horários e datas de atendimento salvos com sucesso.",
    });
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h3 className="font-medium text-slate-900">Agenda de atendimento</h3>
        <p className="mt-1 text-sm text-slate-500">
          O bot usa esta configuração para sugerir e validar horários de reserva.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Início
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputClass}
            required
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Fim
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={inputClass}
            required
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-slate-700">
        Timezone
        <input
          type="text"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className={inputClass}
          placeholder="America/Sao_Paulo"
        />
      </label>

      <div>
        <p className="text-sm font-medium text-slate-700">Dias de atendimento</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const selected = workingDays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleWorkingDay(day.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  selected
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700">Datas bloqueadas</p>
        <p className="mt-1 text-xs text-slate-500">
          Selecione no calendario e clique em adicionar para bloquear.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium text-slate-700">
            Selecionar data
            <input
              type="date"
              value={pendingBlockedDate}
              onChange={(e) => setPendingBlockedDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            onClick={addBlockedDate}
            disabled={!pendingBlockedDate}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          >
            Adicionar data
          </button>
          {blockedDates.length > 0 && (
            <button
              type="button"
              onClick={() => setBlockedDates([])}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Limpar todas
            </button>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Resumo das datas bloqueadas ({blockedDates.length})
          </p>
          {blockedDates.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nenhuma data bloqueada.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {blockedDates.map((date) => (
                <button
                  key={date}
                  type="button"
                  onClick={() => removeBlockedDate(date)}
                  className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100"
                  title="Remover bloqueio"
                >
                  {formatDateLabel(date)} x
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar agenda"}
      </button>
    </form>
  );
}
