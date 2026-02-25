"use client";

import { useState } from "react";
import Link from "next/link";
import { signInAction } from "@/app/actions/auth";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await signInAction(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 shadow-2xl backdrop-blur">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Mendoza IA
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Entre na sua conta para continuar
            </p>
          </div>

          <form action={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

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
                autoComplete="email"
                required
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-300"
              >
                Senha
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
            >
              Entrar
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-400">
            Não tem conta?{" "}
            <Link
              href="/registro"
              className="font-medium text-indigo-400 hover:text-indigo-300"
            >
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
