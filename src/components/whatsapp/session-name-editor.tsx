"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine } from "lucide-react";

interface SessionNameEditorProps {
  sessionId: string;
  initialName: string;
}

export function SessionNameEditor({ sessionId, initialName }: SessionNameEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) {
      setEditing(false);
      setName(initialName);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/session/${sessionId}/name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        throw new Error("Falha ao atualizar nome da sessao");
      }

      setEditing(false);
      router.refresh();
    } catch (err) {
      console.error("[session-name-editor]", err);
    } finally {
      setLoading(false);
    }
  }

  if (editing) {
    return (
      <div className="mb-1 flex w-full items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          className="h-9 w-full rounded-lg border border-white/30 bg-white/10 px-3 text-sm font-semibold text-white outline-none placeholder:text-white/50 focus:border-white/60"
          autoFocus
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="rounded-lg border border-white/30 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "OK"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setName(initialName);
          }}
          disabled={loading}
          className="rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-60"
        >
          X
        </button>
      </div>
    );
  }

  return (
    <div className="mb-1 flex items-center gap-2">
      <h3 className="text-lg font-semibold leading-tight text-white">{initialName}</h3>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/25 bg-white/10 text-white/90 transition hover:bg-white/20"
        aria-label="Editar nome da sessao"
        title="Editar nome"
      >
        <PencilLine className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
