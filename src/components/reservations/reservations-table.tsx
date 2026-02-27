import type { ListReservation } from "@/app/actions/reservations";
import { CancelReservationButton } from "./cancel-reservation-button";

function formatDate(d: Date | string) {
  const dt = typeof d === "string" ? new Date(d) : d;
  const day = dt.getDate().toString().padStart(2, "0");
  const month = (dt.getMonth() + 1).toString().padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTime(d: Date | string) {
  const dt = typeof d === "string" ? new Date(d) : d;
  const hour = dt.getHours().toString().padStart(2, "0");
  const minute = dt.getMinutes().toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: "Pendente",
    confirmed: "Confirmada",
    cancelled: "Cancelada",
  };
  return map[s] ?? s;
}

function sourceLabel(s: string) {
  return s === "ai" ? "IA" : "Manual";
}

export function ReservationsTable({
  reservations,
}: {
  reservations: ListReservation[];
}) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50/50">
          <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
            Data / Horário
          </th>
          <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
            Duração
          </th>
          <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
            Contato
          </th>
          <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
            Veículo
          </th>
          <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
            Status
          </th>
          <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
            Origem
          </th>
          <th className="px-6 py-4 text-right text-sm font-medium text-slate-600">
            Ações
          </th>
        </tr>
      </thead>
      <tbody>
        {reservations.length === 0 ? (
          <tr>
            <td
              colSpan={7}
              className="px-6 py-16 text-center text-slate-500"
            >
              Nenhuma reserva encontrada.
            </td>
          </tr>
        ) : (
          reservations.map((r) => (
            <tr
              key={r.id}
              className="border-b border-slate-100 transition-colors hover:bg-slate-50/50 last:border-0"
            >
              <td className="px-6 py-4" suppressHydrationWarning>
                <span className="font-medium text-slate-900">
                  {formatDate(r.startAt)}
                </span>
                <span className="ml-2 text-slate-500">
                  {formatTime(r.startAt)}
                </span>
              </td>
              <td className="px-6 py-4 text-slate-600">
                {r.durationMinutes} min
              </td>
              <td className="px-6 py-4">
                <span className="font-medium text-slate-900">
                  {("customerName" in r ? (r.customerName as string | null) : r.contactName) || "—"}
                </span>
                {r.contactPhone && (
                  <span className="block text-sm text-slate-500">
                    {r.contactPhone}
                  </span>
                )}
              </td>
              <td className="px-6 py-4 text-sm text-slate-700">
                {("vehicleModel" in r && r.vehicleModel) ||
                ("vehicleYear" in r && r.vehicleYear) ||
                ("vehicleKm" in r && r.vehicleKm) ? (
                  <div className="space-y-0.5">
                    <div>{(r as ListReservation & { vehicleModel?: string | null }).vehicleModel ?? "—"}</div>
                    <div className="text-xs text-slate-500">
                      Ano: {(r as ListReservation & { vehicleYear?: number | null }).vehicleYear ?? "—"} · Km: {(r as ListReservation & { vehicleKm?: number | null }).vehicleKm ?? "—"}
                    </div>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-6 py-4">
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    r.status === "confirmed"
                      ? "bg-green-100 text-green-800"
                      : r.status === "pending"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {statusLabel(r.status)}
                </span>
              </td>
              <td className="px-6 py-4 text-slate-500">
                {sourceLabel(r.source)}
              </td>
              <td className="px-6 py-4 text-right">
                {r.status !== "cancelled" && (
                  <CancelReservationButton reservationId={r.id} />
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
