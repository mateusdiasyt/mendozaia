"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, PlugZap, Plug } from "lucide-react";

interface SessionConnectionActionsProps {
  sessionId: string;
  connected: boolean;
}

export function SessionConnectionActions({
  sessionId,
  connected,
}: SessionConnectionActionsProps) {
  const router = useRouter();
  const [loadingSync, setLoadingSync] = useState(false);
  const [loadingDisconnect, setLoadingDisconnect] = useState(false);
  const [loadingReconnect, setLoadingReconnect] = useState(false);

  async function handleSync() {
    setLoadingSync(true);
    try {
      await fetch(`/api/whatsapp/sync-status/${sessionId}`, { method: "POST" });
      router.refresh();
    } finally {
      setLoadingSync(false);
    }
  }

  async function handleDisconnect() {
    setLoadingDisconnect(true);
    try {
      await fetch(`/api/whatsapp/disconnect/${sessionId}`, { method: "POST" });
      router.refresh();
    } finally {
      setLoadingDisconnect(false);
    }
  }

  async function handleReconnect() {
    setLoadingReconnect(true);
    try {
      await fetch(`/api/whatsapp/reconnect/${sessionId}`, { method: "POST" });
      router.refresh();
    } finally {
      setLoadingReconnect(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={handleSync}
        disabled={loadingSync || loadingDisconnect || loadingReconnect}
        className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
      >
        {loadingSync ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Atualizar
      </button>

      {connected ? (
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={loadingSync || loadingDisconnect || loadingReconnect}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-accent)]/60 bg-[var(--brand-accent)]/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--brand-accent)]/30 disabled:opacity-60"
        >
          {loadingDisconnect ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          Desconectar
        </button>
      ) : (
        <button
          type="button"
          onClick={handleReconnect}
          disabled={loadingSync || loadingDisconnect || loadingReconnect}
          className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
        >
          {loadingReconnect ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlugZap className="h-3.5 w-3.5" />
          )}
          Reconectar
        </button>
      )}
    </div>
  );
}

