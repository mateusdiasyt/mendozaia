"use client";

import { useState, useTransition } from "react";
import { updateAccountNameAction } from "@/app/actions/auth";

export function AccountNameForm({ currentName }: { currentName: string }) {
  const [name, setName] = useState(currentName);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await updateAccountNameAction({ name });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setMessage(result?.message ?? "Nome atualizado.");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        Editar nome da conta
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Seu nome"
          minLength={2}
          maxLength={80}
          required
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
    </form>
  );
}
