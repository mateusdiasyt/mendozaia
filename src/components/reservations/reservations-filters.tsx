"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function ReservationsFilters({ className = "" }: { className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const from = (form.elements.namedItem("from") as HTMLInputElement)?.value;
    const to = (form.elements.namedItem("to") as HTMLInputElement)?.value;
    const status = (form.elements.namedItem("status") as HTMLSelectElement)
      ?.value;

    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    router.push(`/dashboard/reservas?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 ${className}`}
    >
      <div>
        <label
          htmlFor="from"
          className="block text-sm font-medium text-slate-700"
        >
          De
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={searchParams.get("from") ?? ""}
          className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="to" className="block text-sm font-medium text-slate-700">
          Até
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={searchParams.get("to") ?? ""}
          className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label
          htmlFor="status"
          className="block text-sm font-medium text-slate-700"
        >
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={searchParams.get("status") ?? ""}
          className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          <option value="pending">Pendente</option>
          <option value="confirmed">Confirmada</option>
          <option value="cancelled">Cancelada</option>
        </select>
      </div>
      <button
        type="submit"
        className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
      >
        Filtrar
      </button>
      {(searchParams.get("from") ||
        searchParams.get("to") ||
        searchParams.get("status")) && (
        <button
          type="button"
          onClick={() => router.push("/dashboard/reservas")}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Limpar
        </button>
      )}
    </form>
  );
}
