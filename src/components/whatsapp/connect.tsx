"use client";

import { useState } from "react";
import { createWhatsAppSession } from "@/app/actions/whatsapp";

export function WhatsAppConnect({
  organizationId,
}: {
  organizationId: string;
}) {
  const [sessionName, setSessionName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await createWhatsAppSession(organizationId, sessionName || "Sessão 1");
      window.location.reload();
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        value={sessionName}
        onChange={(e) => setSessionName(e.target.value)}
        placeholder="Nome da sessão (opcional)"
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-emerald-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-50"
      >
        {loading ? "Conectando..." : "Nova sessão"}
      </button>
    </form>
  );
}
