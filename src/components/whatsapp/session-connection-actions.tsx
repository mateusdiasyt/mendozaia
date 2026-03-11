"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Plug, X } from "lucide-react";
import { SessionConnect } from "@/components/whatsapp/session-connect";

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
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);

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

  async function handleConnect() {
    setLoadingConnect(true);
    try {
      await fetch(`/api/whatsapp/reconnect/${sessionId}`, { method: "POST" });
      setShowConnectModal(true);
      router.refresh();
    } finally {
      setLoadingConnect(false);
    }
  }

  const anyLoading = loadingSync || loadingDisconnect || loadingConnect;

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSync}
          disabled={anyLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
        >
          {loadingSync ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Atualizar
        </button>

        {connected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={anyLoading}
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
            onClick={handleConnect}
            disabled={anyLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
          >
            {loadingConnect ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plug className="h-3.5 w-3.5" />
            )}
            Conectar
          </button>
        )}
      </div>

      {showConnectModal ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0f0b2d]/70 px-4"
          onClick={() => setShowConnectModal(false)}
        >
          <div
            className="w-full max-w-[420px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/10 p-1.5 text-white transition hover:bg-white/20"
                aria-label="Fechar popup de conexao"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SessionConnect sessionId={sessionId} />
          </div>
        </div>
      ) : null}
    </>
  );
}
