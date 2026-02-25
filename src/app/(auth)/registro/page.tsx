"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/app/actions/auth";

export default function RegistroPage() {
  const router = useRouter();
  const [error, setError] = useState<Record<string, string[]> | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await signUp(formData);

    if (result?.error) {
      setError(result.error as Record<string, string[]>);
      return;
    }

    if (result?.success) {
      router.push("/login?registered=true");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 shadow-2xl backdrop-blur">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Criar conta
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Comece sua jornada com Mendoza IA
            </p>
          </div>

          <form action={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {Object.values(error).flat().join(", ")}
              </div>
            )}

            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-zinc-300"
              >
                Nome completo
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Seu nome"
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
                autoComplete="email"
                required
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="organizationName"
                className="block text-sm font-medium text-zinc-300"
              >
                Nome da empresa
              </label>
              <input
                id="organizationName"
                name="organizationName"
                type="text"
                required
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Minha Empresa"
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
                autoComplete="new-password"
                required
                minLength={8}
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Mínimo 8 caracteres"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-zinc-300"
              >
                Confirmar senha
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
            >
              Criar conta
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-400">
            Já tem conta?{" "}
            <Link
              href="/login"
              className="font-medium text-indigo-400 hover:text-indigo-300"
            >
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
