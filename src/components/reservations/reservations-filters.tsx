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
      className={`rounded-3xl border border-[var(--brand-muted)]/20 bg-white p-4 shadow-sm ${className}`}
    >
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-[var(--brand-deep)]">
        <Filter className="h-4 w-4 text-[var(--brand-primary)]" />
        Filtros da agenda
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label
            htmlFor="from"
            className="block text-xs font-medium text-[var(--brand-muted)]"
          >
            De
          </label>
          <div className="relative mt-1">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-muted)]" />
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={searchParams.get("from") ?? ""}
              className="w-full rounded-xl border border-[var(--brand-muted)]/25 bg-white py-2 pl-9 pr-3 text-sm text-[var(--brand-deep)] focus:border-[var(--brand-primary)] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="to"
            className="block text-xs font-medium text-[var(--brand-muted)]"
          >
            Até
          </label>
          <div className="relative mt-1">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-muted)]" />
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={searchParams.get("to") ?? ""}
              className="w-full rounded-xl border border-[var(--brand-muted)]/25 bg-white py-2 pl-9 pr-3 text-sm text-[var(--brand-deep)] focus:border-[var(--brand-primary)] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="status"
            className="block text-xs font-medium text-[var(--brand-muted)]"
          >
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={searchParams.get("status") ?? ""}
            className="mt-1 w-full rounded-xl border border-[var(--brand-muted)]/25 bg-white px-3 py-2 text-sm text-[var(--brand-deep)] focus:border-[var(--brand-primary)] focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="pending">Pendente</option>
            <option value="confirmed">Confirmada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          <Filter className="h-4 w-4" />
          Aplicar filtros
        </button>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => router.push("/dashboard/reservas")}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-muted)]/25 bg-white px-4 py-2 text-sm font-medium text-[var(--brand-deep)] transition hover:bg-[var(--brand-soft)]"
          >
            <RefreshCw className="h-4 w-4" />
            Limpar
          </button>
        ) : null}
      </div>
    </form>
  );
}
