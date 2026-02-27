"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { reservations, contacts } from "@/lib/db/schema";
import { eq, and, gte, lt, or } from "drizzle-orm";
import {
  checkAvailabilityForOrg,
  createReservationForOrg,
} from "@/lib/reservations";

export async function createReservation(input: {
  startAt: Date;
  durationMinutes?: number;
  contactId?: string;
  notes?: string;
  source?: "manual" | "ai";
}) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const settings = (org.settings as { reservationsEnabled?: boolean }) ?? {};
  if (!settings.reservationsEnabled) {
    return { error: "Sistema de reservas não está ativado" };
  }

  if (input.contactId) {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.id, input.contactId),
          eq(contacts.organizationId, org.id)
        )
      )
      .limit(1);
    if (!contact) return { error: "Contato não encontrado" };
  }

  const result = await createReservationForOrg(org.id, input);
  revalidatePath("/dashboard/reservas");
  return result;
}

export async function listReservations(filters?: {
  from?: Date;
  to?: Date;
  status?: string;
}) {
  const org = await getCurrentOrganization();
  if (!org) return { reservations: [] };

  let query = db
    .select({
      id: reservations.id,
      startAt: reservations.startAt,
      durationMinutes: reservations.durationMinutes,
      status: reservations.status,
      source: reservations.source,
      notes: reservations.notes,
      contactName: contacts.name,
      contactPhone: contacts.phone,
    })
    .from(reservations)
    .leftJoin(contacts, eq(reservations.contactId, contacts.id))
    .where(eq(reservations.organizationId, org.id))
    .orderBy(reservations.startAt);

  const rows = await query;

  let result = rows;
  if (filters?.from) {
    result = result.filter((r) => r.startAt >= filters.from!);
  }
  if (filters?.to) {
    const toEnd = new Date(filters.to);
    toEnd.setDate(toEnd.getDate() + 1);
    result = result.filter((r) => r.startAt < toEnd);
  }
  if (filters?.status) {
    result = result.filter((r) => r.status === filters.status);
  }

  const enriched = result.map((r) => {
    let customerNameFromNotes: string | null = null;
    let vehicleModel: string | null = null;
    let vehicleYear: number | null = null;
    let vehicleKm: number | null = null;

    if (r.notes) {
      try {
        const parsed = JSON.parse(r.notes) as {
          customerName?: string;
          vehicle?: { modelo?: string; ano?: number; km?: number };
        };
        customerNameFromNotes = parsed.customerName ?? null;
        vehicleModel = parsed.vehicle?.modelo ?? null;
        vehicleYear = parsed.vehicle?.ano ?? null;
        vehicleKm = parsed.vehicle?.km ?? null;
      } catch {
        // notas antigas em texto livre
      }
    }

    return {
      ...r,
      customerName: customerNameFromNotes ?? r.contactName ?? null,
      vehicleModel,
      vehicleYear,
      vehicleKm,
    };
  });

  return { reservations: enriched };
}

export type ListReservation = Awaited<
  ReturnType<typeof listReservations>
>["reservations"][number];

export async function cancelReservation(reservationId: string) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const [res] = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!res) return { error: "Reserva não encontrada" };
  if (res.status === "cancelled") return { error: "Reserva já cancelada" };

  await db
    .update(reservations)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(reservations.id, reservationId));

  revalidatePath("/dashboard/reservas");
  return { success: true };
}

export async function checkAvailability(
  dateStr: string,
  timeStr: string,
  durationMinutes: number = 60
): Promise<{ available: boolean; message: string }> {
  const org = await getCurrentOrganization();
  if (!org) return { available: false, message: "Organização não encontrada" };
  return checkAvailabilityForOrg(org.id, dateStr, timeStr, durationMinutes);
}

export async function createReservationFromAI(
  organizationId: string,
  input: {
    dateStr: string;
    timeStr: string;
    contactId: string;
    durationMinutes?: number;
    notes?: string;
  }
) {
  const { available } = await checkAvailabilityForOrg(
    organizationId,
    input.dateStr,
    input.timeStr,
    input.durationMinutes ?? 60
  );
  if (!available) {
    return { error: "Horário não está mais disponível" };
  }

  const year = parseInt(input.dateStr.slice(0, 4), 10);
  const month = parseInt(input.dateStr.slice(5, 7), 10) - 1;
  const day = parseInt(input.dateStr.slice(8, 10), 10);
  const [hour, min] = input.timeStr.split(":").map(Number);
  const startAt = new Date(year, month, day, hour, min ?? 0, 0);

  return createReservationForOrg(organizationId, {
    startAt,
    durationMinutes: input.durationMinutes ?? 60,
    contactId: input.contactId,
    notes: input.notes,
    source: "ai",
  });
}
