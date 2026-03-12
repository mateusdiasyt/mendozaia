"use client";

import { useState } from "react";
import { updateReservationScheduleConfig } from "@/app/actions/organization";

type WeekdayConfig = {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
};

interface ReservationScheduleFormProps {
  initialConfig: {
    start: string;
    end: string;
    timezone: string;
    workingDays: number[];
    blockedDates: string[];
    dateOverrides?: Array<{
      date: string;
      start: string;
      end: string;
      lunchBreakStart?: string | null;
      lunchBreakEnd?: string | null;
      closed?: boolean;
    }>;
    weekdaySchedule?: Array<{
      day: number;
      enabled: boolean;
      start: string;
      end: string;
      lunchBreakStart?: string | null;
      lunchBreakEnd?: string | null;
    }>;
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

function buildInitialWeekdaySchedule(config: ReservationScheduleFormProps["initialConfig"]): WeekdayConfig[] {
  const map = new Map<number, WeekdayConfig>();
  for (const day of WEEKDAYS) {
    map.set(day.value, {
      day: day.value,
      enabled: config.workingDays.includes(day.value),
      start: config.start,
      end: config.end,
    });
  }

  if (Array.isArray(config.weekdaySchedule)) {
    for (const item of config.weekdaySchedule) {
      if (!map.has(item.day)) continue;
      map.set(item.day, {
        day: item.day,
        enabled: Boolean(item.enabled),
        start: item.start || config.start,
        end: item.end || config.end,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.day - b.day);
}

export function ReservationScheduleForm({
  initialConfig,
}: ReservationScheduleFormProps) {
  const [start, setStart] = useState(initialConfig.start);
  const [end, setEnd] = useState(initialConfig.end);
  const [timezone, setTimezone] = useState(initialConfig.timezone);
  const [weekdaySchedule, setWeekdaySchedule] = useState<WeekdayConfig[]>(
    buildInitialWeekdaySchedule(initialConfig)
  );
  const [blockedDates, setBlockedDates] = useState<string[]>(
    [...new Set(initialConfig.blockedDates)].sort()
  );
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function updateWeekday(day: number, patch: Partial<WeekdayConfig>) {
    setWeekdaySchedule((prev) =>
      prev.map((item) => (item.day === day ? { ...item, ...patch } : item))
    );
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
        text: "O horario final base deve ser maior que o inicial.",
      });
      return;
    }

    for (const day of weekdaySchedule) {
      if (!day.enabled) continue;
      if (!day.start || !day.end || day.start >= day.end) {
        setSaving(false);
        setMessage({
          type: "error",
          text: `Horario invalido em ${WEEKDAYS.find((w) => w.value === day.day)?.label}.`,
        });
        return;
      }
    }

    const result = await updateReservationScheduleConfig({
      start,
      end,
      timezone: timezone.trim() || "America/Sao_Paulo",
      workingDays: weekdaySchedule.filter((d) => d.enabled).map((d) => d.day),
      blockedDates,
      weekdaySchedule,
      dateOverrides: [],
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
    "mt-1.5 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Agenda de atendimento</h3>
        <p className="mt-1 text-sm text-slate-500">
          Configure o horario de abertura e fechamento para cada dia da semana.
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

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Inicio base
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputClass}
            required
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Fim base
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={inputClass}
            required
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Timezone
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass}
            placeholder="America/Sao_Paulo"
          />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-sm font-semibold text-slate-900">Horario por dia da semana</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Defina abertura e fechamento por dia.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {weekdaySchedule.map((day) => {
            const label = WEEKDAYS.find((item) => item.value === day.day)?.label ?? String(day.day);
            return (
              <div
                key={day.day}
                className={`rounded-xl border bg-white ${
                  day.enabled ? "border-indigo-100 shadow-sm" : "border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Disponibilidade
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <span className="text-xs text-slate-600">Ativo</span>
                    <input
                      type="checkbox"
                      checked={day.enabled}
                      onChange={(e) => updateWeekday(day.day, { enabled: e.target.checked })}
                      className="peer sr-only"
                    />
                    <span className="relative h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-indigo-500">
                      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
                    </span>
                  </label>
                </div>

                <div className="space-y-2 p-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Dia
                    <input
                      type="text"
                      value={label}
                      readOnly
                      className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      De
                      <input
                        type="time"
                        value={day.start}
                        onChange={(e) => updateWeekday(day.day, { start: e.target.value })}
                        disabled={!day.enabled}
                        className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </label>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Ate
                      <input
                        type="time"
                        value={day.end}
                        onChange={(e) => updateWeekday(day.day, { end: e.target.value })}
                        disabled={!day.enabled}
                        className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700">Datas bloqueadas</p>
        <p className="mt-1 text-xs text-slate-500">
          Clique no calendario para bloquear ou desbloquear as datas.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr,280px]">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
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

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">Bloqueadas ({blockedDates.length})</p>
              {blockedDates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBlockedDates([])}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Limpar
                </button>
              )}
            </div>

            {blockedDates.length > 0 ? (
              <div className="mt-3 space-y-2">
                {blockedDates.map((date) => (
                  <button
                    type="button"
                    key={date}
                    onClick={() => toggleBlockedDate(date)}
                    className="flex w-full items-center justify-between rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-left text-xs font-medium text-red-700 transition hover:bg-red-100"
                  >
                    <span>{formatDateLabel(date)}</span>
                    <span className="text-[11px] opacity-80">Remover</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
                Nenhuma data bloqueada.
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar agenda"}
      </button>
    </form>
  );
}
