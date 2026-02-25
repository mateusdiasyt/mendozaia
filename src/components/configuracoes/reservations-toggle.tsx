"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateReservationsEnabled } from "@/app/actions/organization";

interface ReservationsToggleProps {
  initialEnabled: boolean;
}

export function ReservationsToggle({
  initialEnabled,
}: ReservationsToggleProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      const result = await updateReservationsEnabled(!enabled);
      if (result?.error) {
        throw new Error(result.error);
      }
      setEnabled(!enabled);
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h4 className="font-medium text-slate-900">Sistema de reservas</h4>
        <p className="mt-1 text-sm text-slate-500">
          Ative para permitir que a IA consulte disponibilidade e crie reservas
          quando o cliente solicitar.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={handleToggle}
        disabled={loading}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
          enabled ? "bg-indigo-600" : "bg-slate-200"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
            enabled ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
