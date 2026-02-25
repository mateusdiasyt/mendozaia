import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HomePage() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
          Mendoza IA
        </h1>
        <p className="mt-4 max-w-xl text-lg text-zinc-400">
          CRM de WhatsApp moderno com automação. Gerencie conversas, contatos e
          dispare campanhas em escala.
        </p>
        <div className="mt-8 flex gap-4 justify-center">
          <Link
            href="/login"
            className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Entrar
          </Link>
          <Link
            href="/registro"
            className="rounded-lg border border-zinc-700 px-6 py-3 font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/50"
          >
            Criar conta
          </Link>
        </div>
      </div>
    </div>
  );
}
