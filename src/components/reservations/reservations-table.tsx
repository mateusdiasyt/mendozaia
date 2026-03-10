"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ListReservation } from "@/app/actions/reservations";
import {
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Table,
} from "lucide-react";
import { CancelReservationButton } from "./cancel-reservation-button";

type ReservationRow = ListReservation & {
  customerName?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  vehicleKm?: number | null;
  serviceName?: string | null;
  productName?: string | null;
};

type StatusType = "pending" | "confirmed" | "cancelled";

type ViewMode = "calendar" | "sheet";

const WEEKDAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 18;
const CALENDAR_TOTAL_MINUTES = (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 60;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeekMonday(date: Date): Date {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(date), mondayOffset);
}

function endOfWeekMonday(date: Date): Date {
  return addDays(startOfWeekMonday(date), 6);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isWithin(date: Date, fromInclusive: Date, toInclusive: Date): boolean {
  const value = startOfDay(date).getTime();
  return value >= startOfDay(fromInclusive).getTime() && value <= startOfDay(toInclusive).getTime();
}

function formatDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTime(date: Date): string {
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatDateTime(date: Date): string {
  return `${formatDate(date)} às ${formatTime(date)}`;
}

function formatKm(value: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("pt-BR");
  }
  return "-";
}

function statusLabel(value: string): string {
  const map: Record<string, string> = {
    pending: "Pendente",
    confirmed: "Confirmada",
    cancelled: "Cancelada",
  };
  return map[value] ?? value;
}

function statusClasses(status: string): string {
  if (status === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "pending") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function sourceLabel(value: string): string {
  return value === "ai" ? "IA" : "Manual";
}

function eventPalette(status: string): { block: string; strip: string } {
  if (status === "confirmed") {
    return {
      block: "border-emerald-200 bg-emerald-50 text-emerald-900",
      strip: "bg-emerald-500",
    };
  }
  if (status === "pending") {
    return {
      block: "border-amber-200 bg-amber-50 text-amber-900",
      strip: "bg-amber-500",
    };
  }
  return {
    block: "border-slate-200 bg-slate-100 text-slate-700",
    strip: "bg-slate-400",
  };
}

function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function weekRangeLabel(weekStart: Date, weekEnd: Date): string {
  return `${formatDate(weekStart)} — ${formatDate(weekEnd)}`;
}

function createMonthGrid(monthDate: Date): Array<Date | null> {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const firstWeekdayIndex = (start.getDay() + 6) % 7;
  const daysInMonth = end.getDate();

  const cells: Array<Date | null> = [];
  for (let i = 0; i < firstWeekdayIndex; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function buildEventStyle(dayIndex: number, topPercent: number, heightPercent: number): CSSProperties {
  const columnWidth = 100 / 7;
  return {
    left: `calc(${dayIndex * columnWidth}% + 6px)`,
    width: `calc(${columnWidth}% - 12px)`,
    top: `${topPercent}%`,
    height: `${heightPercent}%`,
  };
}

export function ReservationsTable({
  reservations,
}: {
  reservations: ListReservation[];
}) {
  const normalizedReservations = useMemo(() => {
    const mapped = (reservations as ReservationRow[]).map((item) => ({
      ...item,
      startAtDate: toDate(item.startAt),
    }));

    return mapped.sort((a, b) => b.startAtDate.getTime() - a.startAtDate.getTime());
  }, [reservations]);

  const referenceDate = useMemo(() => {
    if (normalizedReservations.length > 0) {
      return startOfDay(normalizedReservations[0].startAtDate);
    }
    return startOfDay(new Date());
  }, [normalizedReservations]);

  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(referenceDate));
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(referenceDate));

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );

  const weekEnd = weekDays[6];

  const monthCells = useMemo(() => createMonthGrid(monthCursor), [monthCursor]);

  const reservationsForWeek = useMemo(
    () =>
      normalizedReservations
        .filter((item) => isWithin(item.startAtDate, weekStart, weekEnd))
        .sort((a, b) => a.startAtDate.getTime() - b.startAtDate.getTime()),
    [normalizedReservations, weekEnd, weekStart]
  );

  const hasReservationByDay = useMemo(() => {
    const map = new Set<string>();
    normalizedReservations.forEach((item) => {
      const key = `${item.startAtDate.getFullYear()}-${item.startAtDate.getMonth()}-${item.startAtDate.getDate()}`;
      map.add(key);
    });
    return map;
  }, [normalizedReservations]);

  const statusCounters = useMemo(() => {
    const counters: Record<StatusType, number> = {
      confirmed: 0,
      pending: 0,
      cancelled: 0,
    };

    normalizedReservations.forEach((item) => {
      const status = item.status as StatusType;
      if (status in counters) {
        counters[status] += 1;
      }
    });

    return counters;
  }, [normalizedReservations]);

  const sourceCounters = useMemo(() => {
    const counters = { ai: 0, manual: 0 };
    normalizedReservations.forEach((item) => {
      if (item.source === "ai") counters.ai += 1;
      else counters.manual += 1;
    });
    return counters;
  }, [normalizedReservations]);

  if (normalizedReservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
        <CalendarClock className="h-9 w-9 text-slate-400" />
        <p className="mt-3 text-sm font-medium text-slate-900">Nenhuma reserva encontrada</p>
        <p className="mt-1 text-xs text-slate-500">Ajuste os filtros ou cadastre uma nova reserva.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setViewMode("calendar")}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              viewMode === "calendar"
                ? "bg-[var(--brand-primary)] text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Calendar className="h-4 w-4" />
            Calendário
          </button>
          <button
            type="button"
            onClick={() => setViewMode("sheet")}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              viewMode === "sheet"
                ? "bg-[var(--brand-primary)] text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Table className="h-4 w-4" />
            Planilha
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
          {normalizedReservations.length} reserva(s)
        </div>
      </div>

      {viewMode === "calendar" ? (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800 capitalize">{monthLabel(monthCursor)}</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMonthCursor((prev) => addMonths(prev, -1))}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-100"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMonthCursor((prev) => addMonths(prev, 1))}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-100"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKDAY_SHORT.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-1">
                {monthCells.map((cellDate, index) => {
                  if (!cellDate) {
                    return <div key={`empty-${index}`} className="h-8" />;
                  }

                  const isToday = isSameDay(cellDate, new Date());
                  const isInWeek = isWithin(cellDate, weekStart, weekEnd);
                  const hasReservation = hasReservationByDay.has(
                    `${cellDate.getFullYear()}-${cellDate.getMonth()}-${cellDate.getDate()}`
                  );

                  return (
                    <button
                      type="button"
                      key={`${cellDate.toISOString()}-${index}`}
                      onClick={() => {
                        setWeekStart(startOfWeekMonday(cellDate));
                        setMonthCursor(startOfMonth(cellDate));
                      }}
                      className={`relative h-8 rounded-lg text-xs font-medium transition ${
                        isInWeek
                          ? "bg-[var(--brand-primary)] text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      } ${isToday ? "ring-1 ring-[var(--brand-accent)]" : ""}`}
                    >
                      {cellDate.getDate()}
                      {hasReservation ? (
                        <span
                          className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                            isInWeek ? "bg-white" : "bg-[var(--brand-primary)]"
                          }`}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-slate-800">Resumo</p>
              <div className="space-y-2 text-sm">
                <LegendItem color="bg-emerald-500" label="Confirmadas" value={statusCounters.confirmed} />
                <LegendItem color="bg-amber-500" label="Pendentes" value={statusCounters.pending} />
                <LegendItem color="bg-slate-400" label="Canceladas" value={statusCounters.cancelled} />
              </div>
              <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <p>Origem IA: {sourceCounters.ai}</p>
                <p>Origem manual: {sourceCounters.manual}</p>
              </div>
            </div>
          </aside>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart((prev) => addDays(prev, -7))}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart((prev) => addDays(prev, 7))}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <p className="text-base font-semibold text-slate-900">{weekRangeLabel(weekStart, weekEnd)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setWeekStart(startOfWeekMonday(today));
                  setMonthCursor(startOfMonth(today));
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Ir para hoje
              </button>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]">
                  <div className="border-b border-slate-200" />
                  {weekDays.map((day, index) => {
                    const dayName = WEEKDAY_SHORT[index];
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div
                        key={day.toISOString()}
                        className="border-b border-l border-slate-200 px-2 py-2 text-center"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{dayName}</p>
                        <p className={`text-sm font-semibold ${isToday ? "text-[var(--brand-primary)]" : "text-slate-800"}`}>
                          {day.getDate().toString().padStart(2, "0")}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-[64px_1fr]">
                  <div className="relative h-[640px] border-r border-slate-200">
                    {Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR + 1 }).map((_, idx) => {
                      const hour = CALENDAR_START_HOUR + idx;
                      const top = (idx / (CALENDAR_END_HOUR - CALENDAR_START_HOUR)) * 100;
                      return (
                        <span
                          key={`hour-${hour}`}
                          className="absolute left-1 top-0 -translate-y-1/2 text-[11px] text-slate-400"
                          style={{ top: `${top}%` }}
                        >
                          {`${hour.toString().padStart(2, "0")}:00`}
                        </span>
                      );
                    })}
                  </div>

                  <div className="relative h-[640px]">
                    <div className="absolute inset-0 grid grid-cols-7">
                      {weekDays.map((day) => (
                        <div key={`col-${day.toISOString()}`} className="border-l border-slate-100 first:border-l-0" />
                      ))}
                    </div>

                    {Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR + 1 }).map((_, idx) => {
                      const top = (idx / (CALENDAR_END_HOUR - CALENDAR_START_HOUR)) * 100;
                      return (
                        <div
                          key={`line-${idx}`}
                          className="absolute left-0 right-0 border-t border-slate-100"
                          style={{ top: `${top}%` }}
                        />
                      );
                    })}

                    {reservationsForWeek.map((reservation) => {
                      const dayIndex = weekDays.findIndex((day) => isSameDay(day, reservation.startAtDate));
                      if (dayIndex < 0) return null;

                      const startMinutes =
                        reservation.startAtDate.getHours() * 60 + reservation.startAtDate.getMinutes();
                      const minutesFromStart = startMinutes - CALENDAR_START_HOUR * 60;
                      const clampedStart = Math.max(0, Math.min(CALENDAR_TOTAL_MINUTES, minutesFromStart));

                      const duration = Math.max(15, reservation.durationMinutes ?? 60);
                      const endMinutes = Math.min(CALENDAR_TOTAL_MINUTES, clampedStart + duration);
                      const blockMinutes = Math.max(18, endMinutes - clampedStart);

                      const topPercent = (clampedStart / CALENDAR_TOTAL_MINUTES) * 100;
                      const heightPercent = (blockMinutes / CALENDAR_TOTAL_MINUTES) * 100;

                      const palette = eventPalette(reservation.status);
                      const title = reservation.serviceName ?? reservation.productName ?? "Reserva";
                      const customer = reservation.customerName ?? reservation.contactName ?? "Sem nome";

                      return (
                        <div
                          key={reservation.id}
                          className={`absolute overflow-hidden rounded-lg border ${palette.block} shadow-sm`}
                          style={buildEventStyle(dayIndex, topPercent, heightPercent)}
                          title={`${title} · ${customer}`}
                        >
                          <div className={`absolute inset-y-0 left-0 w-1 ${palette.strip}`} />
                          <div className="h-full space-y-0.5 p-2 pl-3 text-xs">
                            <p className="truncate font-semibold">{title}</p>
                            <p className="truncate text-[11px] opacity-80">{customer}</p>
                            <p className="text-[11px] font-medium opacity-80">
                              {formatTime(reservation.startAtDate)} · {reservation.durationMinutes} min
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Data / Hora</th>
                <th className="px-4 py-3">Duração</th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3">Veículo</th>
                <th className="px-4 py-3">Serviço</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
              {normalizedReservations.map((reservation) => {
                const contactName = reservation.customerName ?? reservation.contactName ?? "Sem nome";
                const vehicleModel = reservation.vehicleModel ?? "Sem dados";
                const vehicleMeta =
                  reservation.vehicleYear || reservation.vehicleKm
                    ? `Ano ${reservation.vehicleYear ?? "-"} · KM ${formatKm(reservation.vehicleKm)}`
                    : "Sem dados";
                return (
                  <tr key={reservation.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{formatDateTime(reservation.startAtDate)}</p>
                    </td>
                    <td className="px-4 py-3">{reservation.durationMinutes} min</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{contactName}</p>
                      <p className="text-xs text-slate-500">{reservation.contactPhone ?? "Sem telefone"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{vehicleModel}</p>
                      <p className="text-xs text-slate-500">{vehicleMeta}</p>
                    </td>
                    <td className="px-4 py-3">{reservation.serviceName ?? "Não informado"}</td>
                    <td className="px-4 py-3">{reservation.productName ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(reservation.status)}`}>
                        {statusLabel(reservation.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {sourceLabel(reservation.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {reservation.status !== "cancelled" ? (
                        <CancelReservationButton reservationId={reservation.id} />
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LegendItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="inline-flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-slate-700">{label}</span>
      </div>
      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{value}</span>
    </div>
  );
}
