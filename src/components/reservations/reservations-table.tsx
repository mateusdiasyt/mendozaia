import type { ListReservation } from "@/app/actions/reservations";
import {
  CalendarClock,
  CarFront,
  Clock3,
  Hand,
  UserRound,
  Wrench,
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

function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const day = dt.getDate().toString().padStart(2, "0");
  const month = (dt.getMonth() + 1).toString().padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const hour = dt.getHours().toString().padStart(2, "0");
  const minute = dt.getMinutes().toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function statusLabel(value: string): string {
  const map: Record<string, string> = {
    pending: "Pendente",
    confirmed: "Confirmada",
    cancelled: "Cancelada",
  };
  return map[value] ?? value;
}

function sourceLabel(value: string): string {
  return value === "ai" ? "IA" : "Manual";
}

function statusClass(value: string): string {
  if (value === "confirmed") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  }
  if (value === "pending") {
    return "bg-amber-100 text-amber-700 border-amber-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function formatKm(value: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("pt-BR");
  }
  return "—";
}

export function ReservationsTable({
  reservations,
}: {
  reservations: ListReservation[];
}) {
  const sortedReservations = [...reservations].sort(
    (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
  );

  if (sortedReservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--brand-muted)]/25 bg-[var(--brand-surface)] py-16 text-center">
        <CalendarClock className="h-9 w-9 text-[var(--brand-muted)]" />
        <p className="mt-3 text-sm font-medium text-[var(--brand-deep)]">
          Nenhuma reserva encontrada
        </p>
        <p className="mt-1 text-xs text-[var(--brand-muted)]">
          Ajuste os filtros ou cadastre uma nova reserva.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedReservations.map((reservation) => {
        const row = reservation as ReservationRow;
        const displayName = row.customerName ?? row.contactName ?? "Sem nome";
        const hasVehicleInfo =
          !!row.vehicleModel || !!row.vehicleYear || !!row.vehicleKm;
        const hasCommercialInfo = !!row.serviceName || !!row.productName;

        return (
          <article
            key={reservation.id}
            className="rounded-2xl border border-[var(--brand-muted)]/20 bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-xl bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-primary)]">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {formatDate(reservation.startAt)} às {formatTime(reservation.startAt)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-xl border border-[var(--brand-muted)]/20 bg-white px-2.5 py-1 text-xs font-medium text-[var(--brand-deep)]">
                  <Clock3 className="h-3.5 w-3.5" />
                  {reservation.durationMinutes} min
                </span>
              </div>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(
                  reservation.status
                )}`}
              >
                {statusLabel(reservation.status)}
              </span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <section className="rounded-xl border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] p-3">
                <p className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-muted)]">
                  <UserRound className="h-3.5 w-3.5" />
                  Contato
                </p>
                <p className="text-sm font-semibold text-[var(--brand-deep)]">
                  {displayName}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">
                  {reservation.contactPhone ?? "Sem telefone"}
                </p>
              </section>

              <section className="rounded-xl border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] p-3">
                <p className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-muted)]">
                  <CarFront className="h-3.5 w-3.5" />
                  Veículo
                </p>
                {hasVehicleInfo ? (
                  <>
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      {row.vehicleModel ?? "—"}
                    </p>
                    <p className="text-xs text-[var(--brand-muted)]">
                      Ano: {row.vehicleYear ?? "—"} · KM: {formatKm(row.vehicleKm)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--brand-muted)]">Sem dados</p>
                )}
              </section>

              <section className="rounded-xl border border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] p-3">
                <p className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-muted)]">
                  <Wrench className="h-3.5 w-3.5" />
                  Serviço / Produto
                </p>
                {hasCommercialInfo ? (
                  <>
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      {row.serviceName ?? "—"}
                    </p>
                    <p className="text-xs text-[var(--brand-muted)]">
                      Produto: {row.productName ?? "—"}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--brand-muted)]">Não informado</p>
                )}
              </section>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 rounded-xl border border-[var(--brand-muted)]/20 bg-white px-2.5 py-1 text-xs font-medium text-[var(--brand-deep)]">
                <Hand className="h-3.5 w-3.5" />
                Origem: {sourceLabel(reservation.source)}
              </span>
              {reservation.status !== "cancelled" ? (
                <CancelReservationButton reservationId={reservation.id} />
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
