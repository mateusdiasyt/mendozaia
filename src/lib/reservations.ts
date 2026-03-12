/**
 * Lógica de reservas - usada por actions e pela IA.
 */

import { db } from "@/lib/db";
import {
  reservations,
  contacts,
  organizations,
} from "@/lib/db/schema";
import { eq, and, gte, lt, or, desc } from "drizzle-orm";
import {
  findBestWhatsappSessionIdForOrg,
  parseReservationGroupNotifications,
  sendTextToWhatsAppGroup,
} from "@/lib/whatsapp-group-notifications";

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

function toTimeStrFromMinutes(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export interface ReservationScheduleConfigNormalized {
  start: string;
  end: string;
  timezone: string;
  workingDays: number[];
  blockedDates: string[];
  lunchBreakStart: string;
  lunchBreakEnd: string;
  saturdayEnd: string;
}

type ReservationScheduleWindow = {
  startMinutes: number;
  endMinutes: number;
};

const DEFAULT_RESERVATION_SCHEDULE: ReservationScheduleConfigNormalized = {
  start: "09:00",
  end: "17:00",
  timezone: "America/Sao_Paulo",
  workingDays: [1, 2, 3, 4, 5],
  blockedDates: [],
  lunchBreakStart: "12:00",
  lunchBreakEnd: "13:00",
  saturdayEnd: "12:00",
};

function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function normalizeTimeValue(
  value: unknown,
  fallback: string
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return isValidTimeValue(trimmed) ? trimmed : fallback;
}

function parseDateLocal(dateStr: string): Date | null {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(year, month - 1, day, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function normalizeReservationScheduleConfig(
  config?: Partial<ReservationScheduleConfigNormalized> | null
): ReservationScheduleConfigNormalized {
  const base = DEFAULT_RESERVATION_SCHEDULE;
  const normalized: ReservationScheduleConfigNormalized = {
    start: normalizeTimeValue(config?.start, base.start),
    end: normalizeTimeValue(config?.end, base.end),
    timezone:
      typeof config?.timezone === "string" && config.timezone.trim().length > 0
        ? config.timezone.trim()
        : base.timezone,
    workingDays: Array.isArray(config?.workingDays)
      ? Array.from(
          new Set(
            config.workingDays.filter(
              (day): day is number =>
                typeof day === "number" &&
                Number.isInteger(day) &&
                day >= 0 &&
                day <= 6
            )
          )
        ).sort((a, b) => a - b)
      : [...base.workingDays],
    blockedDates: Array.isArray(config?.blockedDates)
      ? Array.from(
          new Set(
            config.blockedDates
              .filter((date): date is string => typeof date === "string")
              .map((date) => date.trim())
              .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          )
        ).sort()
      : [],
    lunchBreakStart: normalizeTimeValue(
      config?.lunchBreakStart,
      base.lunchBreakStart
    ),
    lunchBreakEnd: normalizeTimeValue(config?.lunchBreakEnd, base.lunchBreakEnd),
    saturdayEnd: normalizeTimeValue(config?.saturdayEnd, base.saturdayEnd),
  };

  const openingMinutes = toMinutes(normalized.start);
  let closingMinutes = toMinutes(normalized.end);
  if (
    openingMinutes < 0 ||
    closingMinutes < 0 ||
    closingMinutes <= openingMinutes
  ) {
    normalized.start = base.start;
    normalized.end = base.end;
    closingMinutes = toMinutes(base.end);
  }

  let saturdayClosingMinutes = toMinutes(normalized.saturdayEnd);
  if (!Number.isFinite(saturdayClosingMinutes) || saturdayClosingMinutes <= 0) {
    saturdayClosingMinutes = Math.min(closingMinutes, toMinutes(base.saturdayEnd));
  }
  if (saturdayClosingMinutes < openingMinutes) {
    saturdayClosingMinutes = openingMinutes;
  }
  if (saturdayClosingMinutes > closingMinutes) {
    saturdayClosingMinutes = closingMinutes;
  }
  normalized.saturdayEnd = toTimeStrFromMinutes(saturdayClosingMinutes);

  const lunchStartMinutes = toMinutes(normalized.lunchBreakStart);
  const lunchEndMinutes = toMinutes(normalized.lunchBreakEnd);
  if (
    lunchStartMinutes < 0 ||
    lunchEndMinutes < 0 ||
    lunchEndMinutes <= lunchStartMinutes
  ) {
    normalized.lunchBreakStart = base.lunchBreakStart;
    normalized.lunchBreakEnd = base.lunchBreakEnd;
  }

  return normalized;
}

function getDayClosingMinutes(
  dateStr: string,
  schedule: ReservationScheduleConfigNormalized
): number {
  const date = parseDateLocal(dateStr);
  if (date && date.getDay() === 6) {
    return toMinutes(schedule.saturdayEnd);
  }
  return toMinutes(schedule.end);
}

export function isDateAllowedForSchedule(
  dateStr: string,
  schedule?: Partial<ReservationScheduleConfigNormalized> | null
): boolean {
  const normalized = normalizeReservationScheduleConfig(schedule);
  if (normalized.blockedDates.includes(dateStr)) return false;
  const date = parseDateLocal(dateStr);
  if (!date) return false;
  return normalized.workingDays.includes(date.getDay());
}

export function getReservationWindowsForDate(
  dateStr: string,
  schedule?: Partial<ReservationScheduleConfigNormalized> | null
): ReservationScheduleWindow[] {
  const normalized = normalizeReservationScheduleConfig(schedule);
  if (!isDateAllowedForSchedule(dateStr, normalized)) return [];

  const openingMinutes = toMinutes(normalized.start);
  const dayClosingMinutes = getDayClosingMinutes(dateStr, normalized);
  if (
    openingMinutes < 0 ||
    dayClosingMinutes < 0 ||
    dayClosingMinutes <= openingMinutes
  ) {
    return [];
  }

  const lunchStartMinutes = toMinutes(normalized.lunchBreakStart);
  const lunchEndMinutes = toMinutes(normalized.lunchBreakEnd);
  const hasLunchBreak =
    lunchStartMinutes >= openingMinutes &&
    lunchEndMinutes <= dayClosingMinutes &&
    lunchEndMinutes > lunchStartMinutes;

  if (!hasLunchBreak) {
    return [{ startMinutes: openingMinutes, endMinutes: dayClosingMinutes }];
  }

  const windows: ReservationScheduleWindow[] = [];
  if (lunchStartMinutes > openingMinutes) {
    windows.push({
      startMinutes: openingMinutes,
      endMinutes: lunchStartMinutes,
    });
  }
  if (lunchEndMinutes < dayClosingMinutes) {
    windows.push({
      startMinutes: lunchEndMinutes,
      endMinutes: dayClosingMinutes,
    });
  }

  return windows.filter((window) => window.endMinutes > window.startMinutes);
}

export function isTimeAllowedForSchedule(
  dateStr: string,
  timeStr: string,
  durationMinutes: number = 60,
  schedule?: Partial<ReservationScheduleConfigNormalized> | null
): boolean {
  if (!isDateAllowedForSchedule(dateStr, schedule)) return false;

  const appointmentStartMinutes = toMinutes(timeStr);
  const safeDuration = Math.max(1, Math.trunc(durationMinutes || 60));
  if (appointmentStartMinutes < 0) return false;

  const appointmentEndMinutes = appointmentStartMinutes + safeDuration;
  const windows = getReservationWindowsForDate(dateStr, schedule);

  return windows.some(
    (window) =>
      appointmentStartMinutes >= window.startMinutes &&
      appointmentEndMinutes <= window.endMinutes
  );
}

function listCandidateStartMinutesForDate(
  dateStr: string,
  durationMinutes: number,
  schedule?: Partial<ReservationScheduleConfigNormalized> | null
): number[] {
  const windows = getReservationWindowsForDate(dateStr, schedule);
  const safeDuration = Math.max(1, Math.trunc(durationMinutes || 60));
  const candidates: number[] = [];

  for (const window of windows) {
    for (
      let candidateStart = window.startMinutes;
      candidateStart + safeDuration <= window.endMinutes;
      candidateStart += 30
    ) {
      candidates.push(candidateStart);
    }
  }

  return Array.from(new Set(candidates)).sort((a, b) => a - b);
}

export function hasRemainingReservableSlotOnDate(
  dateStr: string,
  now: Date,
  durationMinutes: number = 60,
  schedule?: Partial<ReservationScheduleConfigNormalized> | null
): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (
    now.getFullYear() !== year ||
    now.getMonth() + 1 !== month ||
    now.getDate() !== day
  ) {
    return true;
  }

  const safeDuration = Math.max(1, Math.trunc(durationMinutes || 60));
  const nextHalfHour = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
  const candidates = listCandidateStartMinutesForDate(
    dateStr,
    safeDuration,
    schedule
  );

  return candidates.some((candidateStart) => candidateStart >= nextHalfHour);
}

export function buildReservationWindowLabel(
  schedule?: Partial<ReservationScheduleConfigNormalized> | null
): string {
  const normalized = normalizeReservationScheduleConfig(schedule);
  const lunchLabel =
    toMinutes(normalized.lunchBreakEnd) > toMinutes(normalized.lunchBreakStart)
      ? `intervalo ${normalized.lunchBreakStart} as ${normalized.lunchBreakEnd}`
      : null;
  const saturdayDiffers = normalized.saturdayEnd !== normalized.end;
  const saturdayLabel = saturdayDiffers
    ? `sabado ate ${normalized.saturdayEnd}`
    : null;

  const details = [lunchLabel, saturdayLabel].filter(Boolean).join(" | ");
  return details.length > 0
    ? `${normalized.start} as ${normalized.end} (${details})`
    : `${normalized.start} as ${normalized.end}`;
}

function buildOutsideBusinessHoursMessage(
  dateStr: string,
  schedule?: Partial<ReservationScheduleConfigNormalized> | null
): string {
  const normalized = normalizeReservationScheduleConfig(schedule);
  const date = parseDateLocal(dateStr);
  const isSaturday = Boolean(date && date.getDay() === 6);
  const saturdayLine =
    normalized.saturdayEnd !== normalized.end
      ? ` Aos sabados atendemos ate ${normalized.saturdayEnd}.`
      : "";

  const lunchLine =
    toMinutes(normalized.lunchBreakEnd) > toMinutes(normalized.lunchBreakStart)
      ? ` Temos intervalo das ${normalized.lunchBreakStart} as ${normalized.lunchBreakEnd}.`
      : "";

  if (isSaturday) {
    return `Esse horario fica fora do expediente de sabado. Atendemos das ${normalized.start} as ${normalized.saturdayEnd}.${lunchLine}`.trim();
  }

  return `Esse horario fica fora do nosso atendimento. Atendemos das ${normalized.start} as ${normalized.end}.${lunchLine}${saturdayLine}`.trim();
}

export async function checkAvailabilityForOrg(
  organizationId: string,
  dateStr: string,
  timeStr: string,
  durationMinutes: number = 60
): Promise<{
  available: boolean;
  message: string;
  reason:
    | "ok"
    | "reservations_disabled"
    | "date_not_allowed"
    | "outside_business_hours"
    | "slot_unavailable";
  start?: string;
  end?: string;
  suggestedSlots?: string[];
}> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const schedule =
    (settings.reservationSchedule as Record<string, unknown> | undefined) ?? {};
  const businessHours =
    (settings.businessHours as Record<string, unknown> | undefined) ?? {};

  if (!(settings.reservationsEnabled as boolean)) {
    return {
      available: false,
      message: "Sistema de reservas nao esta ativado",
      reason: "reservations_disabled",
    };
  }

  const normalizedSchedule = normalizeReservationScheduleConfig({
    start:
      (schedule.start as string | undefined) ||
      (businessHours.start as string | undefined) ||
      DEFAULT_RESERVATION_SCHEDULE.start,
    end:
      (schedule.end as string | undefined) ||
      (businessHours.end as string | undefined) ||
      DEFAULT_RESERVATION_SCHEDULE.end,
    timezone:
      (schedule.timezone as string | undefined) ||
      (businessHours.timezone as string | undefined) ||
      DEFAULT_RESERVATION_SCHEDULE.timezone,
    workingDays: Array.isArray(schedule.workingDays)
      ? (schedule.workingDays as number[])
      : DEFAULT_RESERVATION_SCHEDULE.workingDays,
    blockedDates: Array.isArray(schedule.blockedDates)
      ? (schedule.blockedDates as string[])
      : [],
    lunchBreakStart: schedule.lunchBreakStart as string | undefined,
    lunchBreakEnd: schedule.lunchBreakEnd as string | undefined,
    saturdayEnd: schedule.saturdayEnd as string | undefined,
  });

  const date = parseDateLocal(dateStr);
  const effectiveEnd =
    date && date.getDay() === 6
      ? normalizedSchedule.saturdayEnd
      : normalizedSchedule.end;

  if (!isDateAllowedForSchedule(dateStr, normalizedSchedule)) {
    return {
      available: false,
      message: "Nao atendemos nessa data.",
      reason: "date_not_allowed",
      start: normalizedSchedule.start,
      end: effectiveEnd,
    };
  }

  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10) - 1;
  const day = parseInt(dateStr.slice(8, 10), 10);
  const [hour, min] = timeStr.split(":").map(Number);

  const startAt = new Date(year, month, day, hour, min ?? 0, 0);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  const startMinutes = hour * 60 + (min ?? 0);
  if (
    !isTimeAllowedForSchedule(
      dateStr,
      timeStr,
      durationMinutes,
      normalizedSchedule
    )
  ) {
    return {
      available: false,
      message: buildOutsideBusinessHoursMessage(dateStr, normalizedSchedule),
      reason: "outside_business_hours",
      start: normalizedSchedule.start,
      end: effectiveEnd,
    };
  }

  const dayStart = new Date(year, month, day, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const dayReservations = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, organizationId),
        or(
          eq(reservations.status, "confirmed"),
          eq(reservations.status, "pending")
        ),
        gte(reservations.startAt, dayStart),
        lt(reservations.startAt, dayEnd)
      )
    );

  const hasOverlap = dayReservations.some((r) => {
    const rEnd = new Date(
      r.startAt.getTime() + (r.durationMinutes || 60) * 60 * 1000
    );
    return r.startAt < endAt && rEnd > startAt;
  });

  const suggestedSlots = hasOverlap
    ? (() => {
        const available: string[] = [];
        for (const candidateStart of listCandidateStartMinutesForDate(
          dateStr,
          durationMinutes,
          normalizedSchedule
        )) {
          if (candidateStart === startMinutes) continue;
          const candidateEnd = candidateStart + durationMinutes;
          const overlaps = dayReservations.some((r) => {
            const reservationStartMinutes =
              r.startAt.getHours() * 60 + r.startAt.getMinutes();
            const reservationDuration = r.durationMinutes || 60;
            const reservationEndMinutes =
              reservationStartMinutes + reservationDuration;
            return (
              reservationStartMinutes < candidateEnd &&
              reservationEndMinutes > candidateStart
            );
          });
          if (!overlaps) {
            available.push(toTimeStrFromMinutes(candidateStart));
          }
          if (available.length >= 5) break;
        }
        return available;
      })()
    : undefined;

  return {
    available: !hasOverlap,
    message: hasOverlap
      ? "Nao ha disponibilidade neste horario."
      : "Horario disponivel para reserva.",
    reason: hasOverlap ? "slot_unavailable" : "ok",
    start: normalizedSchedule.start,
    end: effectiveEnd,
    suggestedSlots,
  };
}
export async function listAvailableSlotsForOrg(
  organizationId: string,
  dateStr: string,
  durationMinutes: number = 60
): Promise<{
  slots: string[];
  message: string;
  reason:
    | "ok"
    | "reservations_disabled"
    | "date_not_allowed"
    | "outside_business_hours"
    | "no_slots";
  start?: string;
  end?: string;
}> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const schedule =
    (settings.reservationSchedule as Record<string, unknown> | undefined) ?? {};
  const businessHours =
    (settings.businessHours as Record<string, unknown> | undefined) ?? {};

  if (!(settings.reservationsEnabled as boolean)) {
    return {
      slots: [],
      message: "Sistema de reservas nao esta ativado.",
      reason: "reservations_disabled",
    };
  }

  const normalizedSchedule = normalizeReservationScheduleConfig({
    start:
      (schedule.start as string | undefined) ||
      (businessHours.start as string | undefined) ||
      DEFAULT_RESERVATION_SCHEDULE.start,
    end:
      (schedule.end as string | undefined) ||
      (businessHours.end as string | undefined) ||
      DEFAULT_RESERVATION_SCHEDULE.end,
    timezone:
      (schedule.timezone as string | undefined) ||
      (businessHours.timezone as string | undefined) ||
      DEFAULT_RESERVATION_SCHEDULE.timezone,
    workingDays: Array.isArray(schedule.workingDays)
      ? (schedule.workingDays as number[])
      : DEFAULT_RESERVATION_SCHEDULE.workingDays,
    blockedDates: Array.isArray(schedule.blockedDates)
      ? (schedule.blockedDates as string[])
      : [],
    lunchBreakStart: schedule.lunchBreakStart as string | undefined,
    lunchBreakEnd: schedule.lunchBreakEnd as string | undefined,
    saturdayEnd: schedule.saturdayEnd as string | undefined,
  });

  const date = parseDateLocal(dateStr);
  const effectiveEnd =
    date && date.getDay() === 6
      ? normalizedSchedule.saturdayEnd
      : normalizedSchedule.end;

  if (!isDateAllowedForSchedule(dateStr, normalizedSchedule)) {
    return {
      slots: [],
      message: "Nao atendemos nessa data.",
      reason: "date_not_allowed",
      start: normalizedSchedule.start,
      end: effectiveEnd,
    };
  }

  const windows = getReservationWindowsForDate(dateStr, normalizedSchedule);
  if (windows.length === 0) {
    return {
      slots: [],
      message: "Horario de atendimento invalido nas configuracoes.",
      reason: "outside_business_hours",
      start: normalizedSchedule.start,
      end: effectiveEnd,
    };
  }

  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10) - 1;
  const day = parseInt(dateStr.slice(8, 10), 10);
  const dayStart = new Date(year, month, day, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const dayReservations = await db
    .select({
      startAt: reservations.startAt,
      durationMinutes: reservations.durationMinutes,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, organizationId),
        or(
          eq(reservations.status, "confirmed"),
          eq(reservations.status, "pending")
        ),
        gte(reservations.startAt, dayStart),
        lt(reservations.startAt, dayEnd)
      )
    );

  const slots: string[] = [];
  for (const candidateStart of listCandidateStartMinutesForDate(
    dateStr,
    durationMinutes,
    normalizedSchedule
  )) {
    const candidateEnd = candidateStart + durationMinutes;
    const overlaps = dayReservations.some((r) => {
      const reservationStartMinutes =
        r.startAt.getHours() * 60 + r.startAt.getMinutes();
      const reservationDuration = r.durationMinutes || 60;
      const reservationEndMinutes = reservationStartMinutes + reservationDuration;
      return (
        reservationStartMinutes < candidateEnd &&
        reservationEndMinutes > candidateStart
      );
    });

    if (!overlaps) {
      slots.push(toTimeStrFromMinutes(candidateStart));
    }
  }

  if (slots.length === 0) {
    return {
      slots: [],
      message: "Sem horarios disponiveis nessa data.",
      reason: "no_slots",
      start: normalizedSchedule.start,
      end: effectiveEnd,
    };
  }

  return {
    slots,
    message: `Horarios disponiveis em ${buildReservationWindowLabel(normalizedSchedule)}.`,
    reason: "ok",
    start: normalizedSchedule.start,
    end: effectiveEnd,
  };
}
type ReservationNotesPayload = {
  customerName?: string | null;
  customerPhone?: string | null;
  vehicle?: {
    modelo?: string | null;
    ano?: number | string | null;
    km?: number | string | null;
  } | null;
  serviceName?: string | null;
  productName?: string | null;
};

function formatDateKeyLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabelPtBrLocal(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTimeLabelPtBrLocal(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function getNowClockInTimezone(timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const day = Number(get("day"));
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const second = Number(get("second"));
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      Number.isFinite(hour) &&
      Number.isFinite(minute) &&
      Number.isFinite(second)
    ) {
      return new Date(year, month - 1, day, hour, minute, second, 0);
    }
  } catch {
    // fallback abaixo
  }
  return new Date();
}

function parseReservationNotes(notes: string | null): ReservationNotesPayload {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes) as ReservationNotesPayload;
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

function formatKm(km: number | string | null | undefined): string {
  if (typeof km === "number" && Number.isFinite(km)) {
    return km.toLocaleString("pt-BR");
  }
  if (typeof km === "string" && km.trim().length > 0) return km.trim();
  return "Nao informado";
}

function formatContactPhone(phone: string | null | undefined): string {
  if (typeof phone === "string" && phone.trim().length > 0) {
    return phone.trim();
  }
  return "Nao informado";
}

function buildDailyReservationsMessage(params: {
  timeZone: string;
  reservations: Array<{
    startAt: Date;
    createdAt: Date;
    serviceName: string | null;
    productName: string | null;
    notes: string | null;
    contactName: string | null;
    contactPhone: string | null;
  }>;
}): string {
  const maxItems = 30;
  const sorted = [...params.reservations].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  const visible = sorted.slice(0, maxItems);
  const hiddenCount = Math.max(0, sorted.length - visible.length);

  const grouped = new Map<string, typeof visible>();
  for (const item of visible) {
    const key = formatDateKeyLocal(item.startAt);
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }

  const now = getNowClockInTimezone(params.timeZone);
  const lines: string[] = [
    "📅 *Agendamentos por data*",
    `⏱️ Atualizado: ${formatTimeLabelPtBrLocal(now)}`,
    "",
  ];

  const groups = Array.from(grouped.entries()).sort(([a], [b]) =>
    b.localeCompare(a)
  );

  for (const [dateKey, items] of groups) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const asDate = new Date(year, (month || 1) - 1, day || 1);
    lines.push(`━━━━━━━━━━━━`);
    lines.push(`📆 *${formatDateLabelPtBrLocal(asDate)}*`);

    for (const reservation of items) {
      const parsedNotes = parseReservationNotes(reservation.notes);
      const service =
        reservation.serviceName ??
        parsedNotes.serviceName ??
        reservation.productName ??
        parsedNotes.productName ??
        "Nao informado";
      const vehicleModel = parsedNotes.vehicle?.modelo ?? "Nao informado";
      const vehicleYear =
        parsedNotes.vehicle?.ano !== undefined &&
        parsedNotes.vehicle?.ano !== null &&
        String(parsedNotes.vehicle.ano).trim().length > 0
          ? String(parsedNotes.vehicle.ano)
          : "Nao informado";
      const customerName =
        parsedNotes.customerName ??
        reservation.contactName ??
        "Nao informado";
      const customerPhone = formatContactPhone(
        parsedNotes.customerPhone ?? reservation.contactPhone
      );

      lines.push(`🕒 Horario: ${formatTimeLabelPtBrLocal(reservation.startAt)}`);
      lines.push(`🔧 Sobre: ${service}`);
      lines.push(`🚗 Carro: ${vehicleModel}`);
      lines.push(`📏 KM: ${formatKm(parsedNotes.vehicle?.km)}`);
      lines.push(`🏷️ Ano: ${vehicleYear}`);
      lines.push(`🙋 Cliente: ${customerName}`);
      lines.push(`📱 Contato: ${customerPhone}`);
      lines.push("");
    }
  }

  if (hiddenCount > 0) {
    lines.push(`➕ ... e mais ${hiddenCount} agendamento(s).`);
  }

  return lines.join("\n").trim();
}

export async function sendReservationGroupListForOrg(
  organizationId: string
): Promise<{ ok: boolean; error?: string }> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const groupConfig = parseReservationGroupNotifications(
    settings.reservationGroupNotifications
  );
  if (!groupConfig.enabled || !groupConfig.groupId) {
    return {
      ok: false,
      error: "Notificação em grupo desativada ou grupo não configurado.",
    };
  }

  const reservationSchedule =
    (settings.reservationSchedule as Record<string, unknown> | undefined) ?? {};
  const timeZone =
    typeof reservationSchedule.timezone === "string" &&
    reservationSchedule.timezone.trim().length > 0
      ? reservationSchedule.timezone.trim()
      : "America/Sao_Paulo";
  const now = getNowClockInTimezone(timeZone);

  const rows = await db
    .select({
      startAt: reservations.startAt,
      createdAt: reservations.createdAt,
      serviceName: reservations.serviceName,
      productName: reservations.productName,
      notes: reservations.notes,
      contactName: contacts.name,
      contactPhone: contacts.phone,
    })
    .from(reservations)
    .leftJoin(contacts, eq(reservations.contactId, contacts.id))
    .where(
      and(
        eq(reservations.organizationId, organizationId),
        or(
          eq(reservations.status, "confirmed"),
          eq(reservations.status, "pending")
        ),
        gte(reservations.startAt, now)
      )
    )
    .orderBy(desc(reservations.createdAt), desc(reservations.startAt))
    .limit(120);
  if (rows.length === 0) {
    return { ok: false, error: "Nenhuma reserva confirmada/pendente para enviar." };
  }

  const sessionId = await findBestWhatsappSessionIdForOrg(organizationId);
  if (!sessionId) {
    return { ok: false, error: "Nenhuma sessão WhatsApp conectada para envio." };
  }

  const message = buildDailyReservationsMessage({
    timeZone,
    reservations: rows,
  });

  const result = await sendTextToWhatsAppGroup({
    sessionId,
    groupId: groupConfig.groupId,
    text: message,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "Falha ao enviar mensagem para o grupo.",
    };
  }

  return { ok: true };
}

export async function createReservationForOrg(
  organizationId: string,
  input: {
    startAt: Date;
    durationMinutes?: number;
    contactId?: string;
    serviceName?: string;
    productName?: string;
    notes?: string;
    source?: "manual" | "ai";
  }
) {
  const [reservation] = await db
    .insert(reservations)
    .values({
      organizationId,
      contactId: input.contactId ?? null,
      startAt: input.startAt,
      durationMinutes: input.durationMinutes ?? 60,
      status: "confirmed",
      source: input.source ?? "manual",
      serviceName: input.serviceName ?? null,
      productName: input.productName ?? null,
      notes: input.notes ?? null,
      updatedAt: new Date(),
    })
    .returning();

  try {
    const notifyResult = await sendReservationGroupListForOrg(organizationId);
    if (!notifyResult.ok) {
      console.warn("[reservations] group notification skipped/failed:", notifyResult.error);
    }
  } catch (err) {
    console.warn("[reservations] sendReservationGroupListForOrg error:", err);
  }

  return { success: true, reservation };
}


