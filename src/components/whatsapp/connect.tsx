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
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-500 disabled:opacity-50"
      >
        {loading ? "Conectando..." : "Nova sessão"}
      </button>
    </form>
  );
}
