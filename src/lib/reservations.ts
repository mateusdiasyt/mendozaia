/**
 * Lógica de reservas - usada por actions e pela IA.
 */

import { db } from "@/lib/db";
import {
  reservations,
  contacts,
  organizations,
} from "@/lib/db/schema";
import { eq, and, gte, lt, or } from "drizzle-orm";

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

function isValidDateForSchedule(
  dateStr: string,
  workingDays: number[],
  blockedDates: string[]
): boolean {
  if (blockedDates.includes(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(year, month - 1, day, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return false;
  return workingDays.includes(dt.getDay());
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
      message: "Sistema de reservas não está ativado",
      reason: "reservations_disabled",
    };
  }

  const start = (schedule.start as string | undefined) || (businessHours.start as string | undefined) || "09:00";
  const end = (schedule.end as string | undefined) || (businessHours.end as string | undefined) || "17:00";
  const workingDays = Array.isArray(schedule.workingDays)
    ? (schedule.workingDays as number[])
    : [1, 2, 3, 4, 5];
  const blockedDates = Array.isArray(schedule.blockedDates)
    ? (schedule.blockedDates as string[])
    : [];

  if (!isValidDateForSchedule(dateStr, workingDays, blockedDates)) {
    return {
      available: false,
      message: "Não atendemos nessa data.",
      reason: "date_not_allowed",
      start,
      end,
    };
  }

  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10) - 1;
  const day = parseInt(dateStr.slice(8, 10), 10);
  const [hour, min] = timeStr.split(":").map(Number);

  const startAt = new Date(year, month, day, hour, min ?? 0, 0);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  const openMinutes = toMinutes(start);
  const closeMinutes = toMinutes(end);
  const startMinutes = hour * 60 + (min ?? 0);
  if (
    openMinutes < 0 ||
    closeMinutes < 0 ||
    closeMinutes <= openMinutes ||
    startMinutes < openMinutes ||
    startMinutes + durationMinutes > closeMinutes
  ) {
    return {
      available: false,
      message: `Atendimento disponível apenas entre ${start} e ${end}.`,
      reason: "outside_business_hours",
      start,
      end,
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

  const suggestedSlots =
    hasOverlap
      ? (() => {
          const available: string[] = [];
          for (
            let candidateStart = openMinutes;
            candidateStart + durationMinutes <= closeMinutes;
            candidateStart += 60
          ) {
            if (candidateStart === startMinutes) continue;
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
      ? "Não há disponibilidade neste horário."
      : "Horário disponível para reserva.",
    reason: hasOverlap ? "slot_unavailable" : "ok",
    start,
    end,
    suggestedSlots,
  };
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

  return { success: true, reservation };
}
