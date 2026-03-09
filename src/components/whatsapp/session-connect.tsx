"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2, CheckCircle } from "lucide-react";

interface SessionConnectProps {
  sessionId: string;
}

export function SessionConnect({ sessionId }: SessionConnectProps) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function syncStatus() {
    setSyncLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/sync-status/${sessionId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao sincronizar");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar");
    } finally {
      setSyncLoading(false);
    }
  }

  async function fetchQR() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/qr/${sessionId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Erro ao obter QR code");
      }

      setQr(data.qr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar QR code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--brand-muted)]/25 bg-[var(--brand-surface)] p-6">
      <h3 className="font-medium text-[var(--brand-deep)]">Conectar WhatsApp</h3>
      <p className="mt-1 text-sm text-[var(--brand-muted)]">
        Escaneie o QR Code com seu WhatsApp
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-[var(--brand-accent)]/35 bg-[var(--brand-accent)]/12 px-4 py-3 text-sm text-[var(--brand-deep)]">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-col items-center gap-4">
        {loading ? (
          <div className="flex h-[280px] w-[280px] items-center justify-center rounded-2xl border border-[var(--brand-muted)]/25 bg-white">
            <Loader2 className="h-12 w-12 animate-spin text-[var(--brand-muted)]" />
          </div>
        ) : qr ? (
          <div className="rounded-2xl border-2 border-[var(--brand-primary)]/20 bg-white p-2 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt="QR Code WhatsApp"
              width={280}
              height={280}
              className="block"
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={fetchQR}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {qr ? (
              <>
                <RefreshCw className="h-4 w-4" />
                Atualizar QR Code
              </>
            ) : (
              <>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Gerar QR Code
              </>
            )}
          </button>
          <button
            onClick={syncStatus}
            disabled={syncLoading}
            className="flex items-center gap-2 rounded-xl border border-[var(--brand-muted)]/25 bg-white px-4 py-2.5 font-medium text-[var(--brand-deep)] shadow-sm transition-colors hover:bg-[var(--brand-soft)] disabled:opacity-50"
          >
            {syncLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            Verificar status
          </button>
        </div>
        <p className="text-center text-xs text-[var(--brand-muted)]">
          Ja conectou no celular? Clique em &quot;Verificar status&quot; para atualizar.
        </p>
      </div>
    </div>
  );
}
