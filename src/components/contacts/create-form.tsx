"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createContact } from "@/app/actions/contacts";

export function CreateContactForm({
  organizationId,
  className = "",
}: {
  organizationId: string;
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await createContact(organizationId, formData);

    if (result?.error) {
      setError(result.error);
      return;
    }

    router.push("/dashboard/contatos");
    router.refresh();
  }

  return (
    <form action={handleSubmit} className={`space-y-4 ${className}`}>
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-zinc-300"
        >
          Nome
        </label>
        <input
          id="name"
          name="name"
          type="text"
          className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-indigo-500 focus:outline-none"
          placeholder="Nome do contato"
        />
      </div>

      <div>
        <label
          htmlFor="phone"
          className="block text-sm font-medium text-zinc-300"
        >
          Telefone *
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-indigo-500 focus:outline-none"
          placeholder="5511999999999"
        />
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-zinc-300"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-indigo-500 focus:outline-none"
          placeholder="email@exemplo.com"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-zinc-700 px-4 py-2 font-medium text-zinc-300 hover:bg-zinc-800"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
