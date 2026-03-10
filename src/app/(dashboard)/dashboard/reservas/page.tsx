import { Suspense } from "react";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { listReservations } from "@/app/actions/reservations";
import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { ReservationsFilters } from "@/components/reservations/reservations-filters";
import { ReservationsTable } from "@/components/reservations/reservations-table";

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
  const confirmedReservations = reservations.filter(
    (item) => item.status === "confirmed"
  ).length;
  const pendingReservations = reservations.filter(
    (item) => item.status === "pending"
  ).length;
  const cancelledReservations = reservations.filter(
    (item) => item.status === "cancelled"
  ).length;

  return (
    <div className="p-8">
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="rounded-3xl border border-[var(--brand-muted)]/20 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-primary)]/10">
              <CalendarClock className="h-6 w-6 text-[var(--brand-primary)]" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
                Reservas
              </h1>
              <p className="mt-1 text-sm text-[var(--brand-muted)]">
                Visual moderno para acompanhar agenda e status em tempo real.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <InfoPill label="Total" value={String(totalReservations)} />
            <InfoPill label="Confirmadas" value={String(confirmedReservations)} />
            <InfoPill label="Pendentes" value={String(pendingReservations)} />
            <InfoPill label="Canceladas" value={String(cancelledReservations)} />
          </div>
        </div>
        <Link
          href="/dashboard/reservas/nova"
          className="inline-flex h-fit items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-4 py-2.5 font-medium text-white shadow-sm transition hover:opacity-90"
        >
          <Plus className="h-5 w-5" />
          Nova reserva
        </Link>
      </div>

      <Suspense fallback={<div className="mb-6 h-28 animate-pulse rounded-2xl bg-slate-100" />}>
        <ReservationsFilters className="mb-6" />
      </Suspense>

      <div className="rounded-3xl border border-[var(--brand-muted)]/20 bg-white p-4 shadow-sm">
        <ReservationsTable reservations={reservations} />
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-[var(--brand-muted)]">
        {label}
      </p>
      <p className="text-lg font-semibold leading-tight text-[var(--brand-deep)]">
        {value}
      </p>
    </div>
  );
}
