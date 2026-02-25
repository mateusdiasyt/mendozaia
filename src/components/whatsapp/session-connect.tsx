"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";

interface SessionConnectProps {
  sessionId: string;
}

export function SessionConnect({ sessionId }: SessionConnectProps) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h3 className="font-medium text-white">Conectar WhatsApp</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Escaneie o QR Code com seu WhatsApp
      </p>

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-col items-center gap-4">
        {loading ? (
          <div className="flex h-[280px] w-[280px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50">
            <Loader2 className="h-12 w-12 animate-spin text-zinc-500" />
          </div>
        ) : qr ? (
          <div className="rounded-lg border-2 border-white p-2">
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

        <button
          onClick={fetchQR}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-500 disabled:opacity-50"
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
      </div>
    </div>
  );
}
