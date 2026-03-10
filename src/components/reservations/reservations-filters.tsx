"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Filter, RefreshCw } from "lucide-react";

export function ReservationsFilters({ className = "" }: { className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const from = (form.elements.namedItem("from") as HTMLInputElement)?.value;
    const to = (form.elements.namedItem("to") as HTMLInputElement)?.value;
    const status = (form.elements.namedItem("status") as HTMLSelectElement)?.value;

    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    router.push(`/dashboard/reservas?${params.toString()}`);
  }

  const hasActiveFilters =
    !!searchParams.get("from") ||
    !!searchParams.get("to") ||
    !!searchParams.get("status");

  return (
    <form
      onSubmit={handleSubmit}
      className={`rounded-xl border border-slate-200 bg-slate-50/70 p-3 ${className}`}
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <Filter className="h-3.5 w-3.5 text-[var(--brand-primary)]" />
        Filtro do calendário
      </div>

      <div className="grid gap-2 lg:grid-cols-[1fr_1fr_150px_auto_auto] lg:items-end">
        <div>
          <label htmlFor="from" className="block text-[11px] font-medium text-slate-600">
            De
          </label>
          <div className="relative mt-1">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={searchParams.get("from") ?? ""}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-[var(--brand-primary)] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="to" className="block text-[11px] font-medium text-slate-600">
            Até
          </label>
          <div className="relative mt-1">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={searchParams.get("to") ?? ""}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-[var(--brand-primary)] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="status" className="block text-[11px] font-medium text-slate-600">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={searchParams.get("status") ?? ""}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-[var(--brand-primary)] focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="pending">Pendente</option>
            <option value="confirmed">Confirmada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>

        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-3 text-xs font-semibold text-white transition hover:opacity-90"
        >
          <Filter className="h-4 w-4" />
          Aplicar
        </button>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => router.push("/dashboard/reservas")}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Limpar
          </button>
        ) : (
          <div className="hidden h-9 lg:block" />
        )}
      </div>
    </form>
  );
}
