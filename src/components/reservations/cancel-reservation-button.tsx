"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelReservation } from "@/app/actions/reservations";

export function CancelReservationButton({
  reservationId,
}: {
  reservationId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCancel() {
    if (!confirm("Deseja cancelar esta reserva?")) return;
    setLoading(true);
    try {
      const result = await cancelReservation(reservationId);
      if (result?.error) {
        alert(result.error);
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCancel}
      disabled={loading}
      className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
    >
      {loading ? "Cancelando…" : "Cancelar"}
    </button>
  );
}
