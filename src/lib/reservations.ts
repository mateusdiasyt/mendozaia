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
            candidateStart += 30
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

type ReservationNotesPayload = {
  customerName?: string | null;
  vehicle?: {
    modelo?: string | null;
    ano?: number | string | null;
    km?: number | string | null;
  } | null;
  serviceName?: string | null;
  productName?: string | null;
};

function formatDateKeyInTimezone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

function formatDateLabelPtBr(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("pt-BR").format(date);
  }
}

function formatTimeLabelPtBr(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
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

function buildDailyReservationsMessage(params: {
  timeZone: string;
  reservations: Array<{
    startAt: Date;
    createdAt: Date;
    serviceName: string | null;
    productName: string | null;
    notes: string | null;
    contactName: string | null;
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
    const key = formatDateKeyInTimezone(item.startAt, params.timeZone);
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }

  const now = new Date();
  const lines: string[] = [
    "📅 *Agendamentos por data*",
    `⏱️ Atualizado: ${formatTimeLabelPtBr(now, params.timeZone)}`,
    "",
  ];

  const groups = Array.from(grouped.entries()).sort(([a], [b]) =>
    b.localeCompare(a)
  );

  for (const [dateKey, items] of groups) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const asDate = new Date(year, (month || 1) - 1, day || 1);
    lines.push(`━━━━━━━━━━━━`);
    lines.push(`📆 *${formatDateLabelPtBr(asDate, params.timeZone)}*`);

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

      lines.push(`🕒 Horario: ${formatTimeLabelPtBr(reservation.startAt, params.timeZone)}`);
      lines.push(`🔧 Sobre: ${service}`);
      lines.push(`🚗 Carro: ${vehicleModel}`);
      lines.push(`📏 KM: ${formatKm(parsedNotes.vehicle?.km)}`);
      lines.push(`🏷️ Ano: ${vehicleYear}`);
      lines.push(`🙋 Cliente: ${customerName}`);
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

  const rows = await db
    .select({
      startAt: reservations.startAt,
      createdAt: reservations.createdAt,
      serviceName: reservations.serviceName,
      productName: reservations.productName,
      notes: reservations.notes,
      contactName: contacts.name,
    })
    .from(reservations)
    .leftJoin(contacts, eq(reservations.contactId, contacts.id))
    .where(
      and(
        eq(reservations.organizationId, organizationId),
        or(
          eq(reservations.status, "confirmed"),
          eq(reservations.status, "pending")
        )
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
