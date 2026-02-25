import { Suspense } from "react";
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

      <Suspense fallback={<div className="mb-6 h-20 animate-pulse rounded-xl bg-slate-100" />}>
        <ReservationsFilters className="mb-6" />
      </Suspense>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ReservationsTable reservations={reservations} />
      </div>
    </div>
  );
}
