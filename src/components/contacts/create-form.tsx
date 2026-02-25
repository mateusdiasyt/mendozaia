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
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-slate-700"
        >
          Nome
        </label>
        <input
          id="name"
          name="name"
          type="text"
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Nome do contato"
        />
      </div>

      <div>
        <label
          htmlFor="phone"
          className="block text-sm font-medium text-slate-700"
        >
          Telefone *
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="5511999999999"
        />
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-slate-700"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="email@exemplo.com"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
