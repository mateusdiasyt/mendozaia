import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { conversations, contacts } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { MessageSquare, Users } from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();
  const org = await getCurrentOrganization();
  if (!org) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-400">Nenhuma organização encontrada.</p>
      </div>
    );
  }

  const [conversationsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.organizationId, org.id));

  const [contactsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.organizationId, org.id));

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">
          Olá, {session?.user?.name?.split(" ")[0] ?? "usuário"}
        </h1>
        <p className="mt-1 text-zinc-400">{org.name}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/dashboard"
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-indigo-500/50 hover:bg-zinc-900"
        >
          <MessageSquare className="h-10 w-10 text-indigo-400" />
          <h3 className="mt-4 font-medium text-white">Conversas</h3>
          <p className="mt-1 text-3xl font-semibold text-white">
            {conversationsCount?.count ?? 0}
          </p>
          <p className="mt-1 text-sm text-zinc-400">Caixa de entrada</p>
        </Link>

        <Link
          href="/dashboard/contatos"
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-indigo-500/50 hover:bg-zinc-900"
        >
          <Users className="h-10 w-10 text-indigo-400" />
          <h3 className="mt-4 font-medium text-white">Contatos</h3>
          <p className="mt-1 text-3xl font-semibold text-white">
            {contactsCount?.count ?? 0}
          </p>
          <p className="mt-1 text-sm text-zinc-400">Total de contatos</p>
        </Link>

        <Link
          href="/dashboard/whatsapp"
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-indigo-500/50 hover:bg-zinc-900"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
            <MessageSquare className="h-5 w-5 text-green-400" />
          </div>
          <h3 className="mt-4 font-medium text-white">WhatsApp</h3>
          <p className="mt-1 text-sm text-zinc-400">Conectar sessão</p>
        </Link>
      </div>

      <div className="mt-12 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="font-medium text-white">Início rápido</h2>
        <ul className="mt-4 space-y-2 text-sm text-zinc-400">
          <li>1. Conecte seu WhatsApp em &quot;WhatsApp&quot;</li>
          <li>2. Importe ou adicione contatos</li>
          <li>3. Configure respostas automáticas em &quot;Automação&quot;</li>
        </ul>
      </div>
    </div>
  );
}
