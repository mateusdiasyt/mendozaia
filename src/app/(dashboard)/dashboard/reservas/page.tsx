import { getCurrentOrganization } from "@/lib/auth-utils";
import { listReservations } from "@/app/actions/reservations";
import Link from "next/link";
import { Plus } from "lucide-react";
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

  const params = await searchParams;
  const from = params.from ? new Date(params.from) : undefined;
  const to = params.to ? new Date(params.to) : undefined;
  const status = params.status;

  const { reservations } = await listReservations({
    from,
    to,
    status: status || undefined,
  });

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Reservas</h1>
          <p className="mt-1 text-slate-500">
            Gerencie reservas e consulte disponibilidade
          </p>
        </div>
        <Link
          href="/dashboard/reservas/nova"
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-5 w-5" />
          Nova reserva
        </Link>
      </div>

      <ReservationsFilters className="mb-6" />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ReservationsTable reservations={reservations} />
      </div>
    </div>
  );
}
