"use client";

import { useState } from "react";
import { updateReservationScheduleConfig } from "@/app/actions/organization";

type DateOverride = {
  date: string;
  start: string;
  end: string;
  lunchBreakStart?: string | null;
  lunchBreakEnd?: string | null;
  closed?: boolean;
};

interface ReservationScheduleFormProps {
  initialConfig: {
    start: string;
    end: string;
    timezone: string;
    workingDays: number[];
    blockedDates: string[];
    dateOverrides?: DateOverride[];
  };
}

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
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
  const [dateOverrides, setDateOverrides] = useState<DateOverride[]>(
    [...(initialConfig.dateOverrides ?? [])]
      .filter((item) => item?.date)
      .sort((a, b) => a.date.localeCompare(b.date))
  );
  const [pendingOverrideDate, setPendingOverrideDate] = useState("");
  const [pendingOverrideStart, setPendingOverrideStart] = useState("09:00");
  const [pendingOverrideEnd, setPendingOverrideEnd] = useState("18:00");
  const [pendingOverrideLunchStart, setPendingOverrideLunchStart] = useState("12:00");
  const [pendingOverrideLunchEnd, setPendingOverrideLunchEnd] = useState("13:00");
  const [pendingBlockedDate, setPendingBlockedDate] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
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

  function formatDateLabel(date: string): string {
    const [year, month, day] = date.split("-");
    if (!year || !month || !day) return date;
    return `${day}/${month}/${year}`;
  }

  function toIsoDate(year: number, monthIndex: number, day: number): string {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function buildMonthCells(baseDate: Date): Array<{ iso: string | null; day: number | null }> {
    const year = baseDate.getFullYear();
    const monthIndex = baseDate.getMonth();
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const cells: Array<{ iso: string | null; day: number | null }> = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ iso: null, day: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ iso: toIsoDate(year, monthIndex, day), day });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ iso: null, day: null });
    }
    return cells;
  }

  function toggleBlockedDate(date: string) {
    setBlockedDates((prev) =>
      prev.includes(date)
        ? prev.filter((d) => d !== date)
        : [...new Set([...prev, date])].sort()
    );
  }

  function addDateOverride() {
    if (!pendingOverrideDate) return;
    if (pendingOverrideStart >= pendingOverrideEnd) {
      setMessage({
        type: "error",
        text: "No ajuste por data, o horario final deve ser maior que o inicial.",
      });
      return;
    }

    let lunchBreakStart: string | null = null;
    let lunchBreakEnd: string | null = null;
    if (pendingOverrideLunchStart && pendingOverrideLunchEnd) {
      if (pendingOverrideLunchStart < pendingOverrideLunchEnd) {
        lunchBreakStart = pendingOverrideLunchStart;
        lunchBreakEnd = pendingOverrideLunchEnd;
      }
    }

    const next: DateOverride = {
      date: pendingOverrideDate,
      start: pendingOverrideStart,
      end: pendingOverrideEnd,
      lunchBreakStart,
      lunchBreakEnd,
      closed: false,
    };

    setDateOverrides((prev) => {
      const map = new Map(prev.map((item) => [item.date, item]));
      map.set(next.date, next);
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    });

    setPendingOverrideDate("");
    setMessage(null);
  }

  function removeDateOverride(date: string) {
    setDateOverrides((prev) => prev.filter((item) => item.date !== date));
  }

  const blockedDateSet = new Set(blockedDates);
  const monthCells = buildMonthCells(monthCursor);
  const monthTitle = monthCursor.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    if (start >= end) {
      setSaving(false);
      setMessage({
        type: "error",
        text: "O horario final deve ser maior que o horario inicial.",
      });
      return;
    }

    const result = await updateReservationScheduleConfig({
      start,
      end,
      timezone: timezone.trim() || "America/Sao_Paulo",
      workingDays,
      blockedDates,
      dateOverrides,
    });

    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({
      type: "success",
      text: "Agenda salva com sucesso.",
    });
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h3 className="font-medium text-slate-900">Agenda de atendimento</h3>
        <p className="mt-1 text-sm text-slate-500">
          Configure horario base e excecoes por data para o bot sugerir os horarios certos.
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
          Inicio
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

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Configuracao por data</p>
        <p className="mt-1 text-xs text-slate-500">
          Use para excecoes especificas (ex: feriado, meio expediente, horario especial).
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <label className="text-sm font-medium text-slate-700 md:col-span-2">
            Data
            <input
              type="date"
              value={pendingOverrideDate}
              onChange={(e) => setPendingOverrideDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Inicio
            <input
              type="time"
              value={pendingOverrideStart}
              onChange={(e) => setPendingOverrideStart(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Fim
            <input
              type="time"
              value={pendingOverrideEnd}
              onChange={(e) => setPendingOverrideEnd(e.target.value)}
              className={inputClass}
            />
          </label>
          <div className="md:col-span-5 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">
              Intervalo inicio
              <input
                type="time"
                value={pendingOverrideLunchStart}
                onChange={(e) => setPendingOverrideLunchStart(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Intervalo fim
              <input
                type="time"
                value={pendingOverrideLunchEnd}
                onChange={(e) => setPendingOverrideLunchEnd(e.target.value)}
                className={inputClass}
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={addDateOverride}
                className="h-11 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
              >
                Salvar data
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {dateOverrides.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
              Nenhuma excecao por data cadastrada.
            </div>
          ) : (
            dateOverrides.map((item) => (
              <div key={item.date} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <div className="text-slate-700">
                  <span className="font-semibold">{formatDateLabel(item.date)}</span>
                  <span className="ml-2">{item.start} as {item.end}</span>
                  {item.lunchBreakStart && item.lunchBreakEnd && (
                    <span className="ml-2 text-slate-500">(intervalo {item.lunchBreakStart}-{item.lunchBreakEnd})</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeDateOverride(item.date)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Remover
                </button>
              </div>
            ))
          )}
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

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setMonthCursor(
                  (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                )
              }
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              {"<"}
            </button>
            <p className="text-sm font-semibold capitalize text-slate-800">
              {monthTitle}
            </p>
            <button
              type="button"
              onClick={() =>
                setMonthCursor(
                  (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                )
              }
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              {">"}
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
            {WEEKDAYS.map((weekday) => (
              <div key={`weekday-${weekday.value}`} className="py-1">
                {weekday.label}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthCells.map((cell, idx) => {
              if (!cell.iso || !cell.day) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="h-9 rounded-md bg-slate-50"
                  />
                );
              }
              const isBlocked = blockedDateSet.has(cell.iso);
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => toggleBlockedDate(cell.iso!)}
                  className={`h-9 rounded-md border text-sm transition ${
                    isBlocked
                      ? "border-red-300 bg-red-100 font-semibold text-red-700 hover:bg-red-200"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  title={isBlocked ? "Clique para desbloquear" : "Clique para bloquear"}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar agenda"}
      </button>
    </form>
  );
}
