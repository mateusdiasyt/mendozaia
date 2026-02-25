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
    <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6">
      <h3 className="font-medium text-slate-900">Conectar WhatsApp</h3>
      <p className="mt-1 text-sm text-slate-500">
        Escaneie o QR Code com seu WhatsApp
      </p>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-col items-center gap-4">
        {loading ? (
          <div className="flex h-[280px] w-[280px] items-center justify-center rounded-xl border border-slate-200 bg-white">
            <Loader2 className="h-12 w-12 animate-spin text-slate-400" />
          </div>
        ) : qr ? (
          <div className="rounded-xl border-2 border-slate-200 bg-white p-2">
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
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-50"
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
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {syncLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            Verificar status
          </button>
        </div>
        <p className="text-center text-xs text-slate-500">
          Já conectou no celular? Clique em &quot;Verificar status&quot; para
          atualizar.
        </p>
      </div>
    </div>
  );
}
