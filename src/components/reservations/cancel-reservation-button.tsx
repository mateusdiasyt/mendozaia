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
  const [openConfirm, setOpenConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConfirmCancel() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await cancelReservation(reservationId);
      if (result?.error) {
        setErrorMessage(result.error);
        return;
      }
      setOpenConfirm(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErrorMessage(null);
          setOpenConfirm(true);
        }}
        disabled={loading}
        className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
      >
        {loading ? "Cancelando..." : "Cancelar"}
      </button>

      {openConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#6C6C94]/40 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-[#131047]">Cancelar reserva</h3>
            <p className="mt-2 text-sm text-[#6C6C94]">
              Tem certeza que deseja cancelar esta reserva?
            </p>
            {errorMessage ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (loading) return;
                  setOpenConfirm(false);
                }}
                disabled={loading}
                className="rounded-xl border border-[#C8CCE5] px-4 py-2 text-sm font-medium text-[#131047] hover:bg-[#F4F5FF] disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={loading}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {loading ? "Cancelando..." : "Sim, cancelar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
