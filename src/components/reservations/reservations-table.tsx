import type { ListReservation } from "@/app/actions/reservations";
import type { ReactNode } from "react";
import {
  CalendarClock,
  CarFront,
  Clock3,
  ContactRound,
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
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (value === "pending") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function formatKm(value: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("pt-BR");
  }
  return "-";
}

function FieldCard({
  icon,
  label,
  value,
  subvalue,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subvalue?: string;
}) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </p>
      <p className="text-base font-semibold leading-tight text-slate-900">{value}</p>
      {subvalue ? <p className="text-sm text-slate-600">{subvalue}</p> : null}
    </div>
  );
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
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
        <CalendarClock className="h-9 w-9 text-slate-400" />
        <p className="mt-3 text-sm font-medium text-slate-900">
          Nenhuma reserva encontrada
        </p>
        <p className="mt-1 text-xs text-slate-500">
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
        const displayPhone = reservation.contactPhone ?? "Sem telefone";

        const vehicleName = row.vehicleModel ?? "Sem dados";
        const vehicleMeta =
          row.vehicleYear || row.vehicleKm
            ? `Ano ${row.vehicleYear ?? "-"} · KM ${formatKm(row.vehicleKm)}`
            : undefined;

        const serviceName = row.serviceName ?? "Não informado";
        const serviceMeta = row.productName
          ? `Produto: ${row.productName}`
          : undefined;

        return (
          <article
            key={reservation.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {formatDate(reservation.startAt)} às {formatTime(reservation.startAt)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                  <Clock3 className="h-3.5 w-3.5" />
                  {reservation.durationMinutes} min
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(
                    reservation.status
                  )}`}
                >
                  {statusLabel(reservation.status)}
                </span>
                {reservation.status !== "cancelled" ? (
                  <CancelReservationButton reservationId={reservation.id} />
                ) : null}
              </div>
            </header>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <FieldCard
                icon={<UserRound className="h-3.5 w-3.5" />}
                label="Contato"
                value={displayName}
                subvalue={displayPhone}
              />

              <FieldCard
                icon={<CarFront className="h-3.5 w-3.5" />}
                label="Veículo"
                value={vehicleName}
                subvalue={vehicleMeta}
              />

              <FieldCard
                icon={<Wrench className="h-3.5 w-3.5" />}
                label="Serviço / Produto"
                value={serviceName}
                subvalue={serviceMeta}
              />
            </div>

            <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                <ContactRound className="h-3.5 w-3.5" />
                Origem: {sourceLabel(reservation.source)}
              </span>
              {reservation.status === "cancelled" ? (
                <span className="text-xs font-medium text-slate-500">
                  Reserva já cancelada
                </span>
              ) : null}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
