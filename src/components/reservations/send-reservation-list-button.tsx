"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { sendReservationListToGroupNow } from "@/app/actions/reservations";

export function SendReservationListButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function handleSend() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendReservationListToGroupNow();
      if (result?.error) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "success", text: "Lista enviada para o grupo." });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSend}
        disabled={isPending}
        className="inline-flex h-fit items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        Enviar lista
      </button>

      {message ? (
        <p
          className={`text-xs ${
            message.type === "success" ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
