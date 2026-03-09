"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

interface SessionSyncButtonProps {
  sessionId: string;
  className?: string;
}

export function SessionSyncButton({ sessionId, className = "" }: SessionSyncButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSync() {
    setLoading(true);
    try {
      await fetch(`/api/whatsapp/sync-status/${sessionId}`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-60 ${className}`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      Atualizar sessão
    </button>
  );
}

