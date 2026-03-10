import { getCurrentOrganization } from "@/lib/auth-utils";
import { listReservations } from "@/app/actions/reservations";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { ReservationsTable } from "@/components/reservations/reservations-table";
import { SendReservationListButton } from "@/components/reservations/send-reservation-list-button";
import { NewReservationModal } from "@/components/reservations/new-reservation-modal";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const settings = (org.settings as Record<string, unknown>) ?? {};
  if (!settings.reservationsEnabled) {
    return (
      <div className="p-8">
        <p className="text-slate-600">
          O sistema de reservas não está ativado. Ative em{" "}
          <Link
            href="/dashboard/configuracoes"
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            Configurações
          </Link>
          .
        </p>
      </div>
    );
  }

  const orgContacts = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.organizationId, org.id))
    .orderBy(contacts.name);

  let reservations: Awaited<ReturnType<typeof listReservations>>["reservations"] = [];
  try {
    const params = await searchParams;
    const fromStr = params.from?.trim();
    const toStr = params.to?.trim();
    const from = fromStr && !Number.isNaN(Date.parse(fromStr)) ? new Date(fromStr) : undefined;
    const to = toStr && !Number.isNaN(Date.parse(toStr)) ? new Date(toStr) : undefined;
    const status = params.status?.trim() || undefined;

    const result = await listReservations({
      from,
      to,
      status: status || undefined,
    });
    reservations = result.reservations;
  } catch (err) {
    console.error("[reservas] Erro ao carregar:", err);
    return (
      <div className="p-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <p className="font-medium">Erro ao carregar reservas</p>
          <p className="mt-1 text-sm">
            Verifique se as migrações do banco foram executadas (db:push ou db:migrate).
          </p>
        </div>
      </div>
    );
  }

  const totalReservations = reservations.length;
  const confirmedReservations = reservations.filter((item) => item.status === "confirmed").length;
  const pendingReservations = reservations.filter((item) => item.status === "pending").length;
  const cancelledReservations = reservations.filter((item) => item.status === "cancelled").length;

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[var(--brand-primary)]">
            <CalendarClock className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Reservas</h1>
          </div>
          <p className="text-sm text-slate-600">
            Visual em calendário + planilha para acompanhar horários com clareza.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <SendReservationListButton />
          <NewReservationModal contacts={orgContacts} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoPill label="Total" value={String(totalReservations)} />
        <InfoPill label="Confirmadas" value={String(confirmedReservations)} />
        <InfoPill label="Pendentes" value={String(pendingReservations)} />
        <InfoPill label="Canceladas" value={String(cancelledReservations)} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <ReservationsTable reservations={reservations} />
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-semibold leading-tight text-slate-900">{value}</p>
    </div>
  );
}
