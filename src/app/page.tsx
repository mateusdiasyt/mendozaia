import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HomePage() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
          Mendoza IA
        </h1>
        <p className="mt-6 text-lg text-slate-600">
          CRM de WhatsApp moderno com automação. Gerencie conversas, contatos e
          dispare campanhas em escala.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link
            href="/login"
            className="rounded-xl bg-indigo-600 px-8 py-3.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
          >
            Entrar
          </Link>
          <Link
            href="/registro"
            className="rounded-xl border border-slate-300 bg-white px-8 py-3.5 font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Criar conta
          </Link>
        </div>
      </div>
    </div>
  );
}
