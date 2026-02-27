"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createReservation, checkAvailability } from "@/app/actions/reservations";

type Contact = { id: string; name: string | null; phone: string };

export function CreateReservationForm({
  contacts,
  className = "",
}: {
  contacts: Contact[];
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [availabilityMsg, setAvailabilityMsg] = useState<string | null>(null);

  async function handleCheckAvailability(
    dateStr: string,
    timeStr: string,
    duration: number
  ) {
    if (!dateStr || !timeStr) return;
    setChecking(true);
    setAvailabilityMsg(null);
    try {
      const { available, message } = await checkAvailability(
        dateStr,
        timeStr,
        duration
      );
      setAvailabilityMsg(
        available ? `✓ ${message}` : `✗ ${message}`
      );
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    const dateStr = formData.get("date") as string;
    const timeStr = formData.get("time") as string;
    const duration = parseInt(
      (formData.get("duration") as string) || "60",
      10
    );
    const contactId = (formData.get("contactId") as string) || undefined;
    const serviceName = (formData.get("serviceName") as string)?.trim() || undefined;
    const productName = (formData.get("productName") as string)?.trim() || undefined;
    const notes = (formData.get("notes") as string) || undefined;

    if (!dateStr || !timeStr) {
      setError("Data e horário são obrigatórios.");
      return;
    }

    const [year, month, day] = dateStr.split("-").map(Number);
    const [hour, min] = timeStr.split(":").map(Number);
    const startAt = new Date(year, month - 1, day, hour, min ?? 0, 0);

    const result = await createReservation({
      startAt,
      durationMinutes: duration,
      contactId: contactId || undefined,
      serviceName,
      productName,
      notes: notes || undefined,
      source: "manual",
    });

    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }

    router.push("/dashboard/reservas");
    router.refresh();
  }

  return (
    <form action={handleSubmit} className={`space-y-4 ${className}`}>
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="date"
            className="block text-sm font-medium text-slate-700"
          >
            Data *
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(e) => {
              const date = e.target.value;
              const time = (
                document.getElementById("time") as HTMLInputElement
              )?.value;
              const dur = parseInt(
                (document.getElementById("duration") as HTMLSelectElement)
                  ?.value || "60",
                10
              );
              if (date && time) handleCheckAvailability(date, time, dur);
            }}
          />
        </div>
        <div>
          <label
            htmlFor="time"
            className="block text-sm font-medium text-slate-700"
          >
            Horário *
          </label>
          <input
            id="time"
            name="time"
            type="time"
            required
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(e) => {
              const time = e.target.value;
              const date = (
                document.getElementById("date") as HTMLInputElement
              )?.value;
              const dur = parseInt(
                (document.getElementById("duration") as HTMLSelectElement)
                  ?.value || "60",
                10
              );
              if (date && time) handleCheckAvailability(date, time, dur);
            }}
          />
        </div>
      </div>

      {availabilityMsg && (
        <p
          className={`text-sm ${
            availabilityMsg.startsWith("✓")
              ? "text-green-600"
              : "text-amber-600"
          }`}
        >
          {checking ? "Verificando…" : availabilityMsg}
        </p>
      )}

      <div>
        <label
          htmlFor="duration"
          className="block text-sm font-medium text-slate-700"
        >
          Duração
        </label>
        <select
          id="duration"
          name="duration"
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          onChange={(e) => {
            const date = (
              document.getElementById("date") as HTMLInputElement
            )?.value;
            const time = (
              document.getElementById("time") as HTMLInputElement
            )?.value;
            const dur = parseInt(e.target.value, 10);
            if (date && time) handleCheckAvailability(date, time, dur);
          }}
        >
          <option value="30">30 min</option>
          <option value="60">1 h</option>
          <option value="90">1h 30</option>
          <option value="120">2 h</option>
        </select>
      </div>

      <div>
        <label
          htmlFor="contactId"
          className="block text-sm font-medium text-slate-700"
        >
          Contato
        </label>
        <select
          id="contactId"
          name="contactId"
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Nenhum</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.phone} {c.phone ? `(${c.phone})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="serviceName"
          className="block text-sm font-medium text-slate-700"
        >
          Serviço
        </label>
        <input
          id="serviceName"
          name="serviceName"
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Ex.: Troca de óleo"
        />
      </div>

      <div>
        <label
          htmlFor="productName"
          className="block text-sm font-medium text-slate-700"
        >
          Produto
        </label>
        <input
          id="productName"
          name="productName"
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Ex.: Óleo 5W30"
        />
      </div>

      <div>
        <label
          htmlFor="notes"
          className="block text-sm font-medium text-slate-700"
        >
          Observações
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Informações adicionais"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          Criar reserva
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
