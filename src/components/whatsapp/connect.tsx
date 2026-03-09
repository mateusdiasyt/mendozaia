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
      await createWhatsAppSession(organizationId, sessionName || "Sessao 1");
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
        placeholder="Nome da conexao (opcional)"
        className="w-full rounded-xl border border-[var(--brand-muted)]/25 bg-white px-4 py-2.5 text-[var(--brand-deep)] placeholder-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Conectando..." : "Conectar WhatsApp"}
      </button>
    </form>
  );
}
