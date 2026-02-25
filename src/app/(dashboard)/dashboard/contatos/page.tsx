import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function ContatosPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const orgContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.organizationId, org.id))
    .orderBy(contacts.createdAt);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Contatos</h1>
          <p className="mt-1 text-zinc-400">
            Gerencie seus contatos e etiquetas
          </p>
        </div>
        <Link
          href="/dashboard/contatos/novo"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-5 w-5" />
          Novo contato
        </Link>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="px-6 py-4 text-left text-sm font-medium text-zinc-400">
                Nome
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-zinc-400">
                Telefone
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-zinc-400">
                Email
              </th>
              <th className="px-6 py-4 text-right text-sm font-medium text-zinc-400">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {orgContacts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-zinc-400">
                  Nenhum contato ainda. Adicione seu primeiro contato.
                </td>
              </tr>
            ) : (
              orgContacts.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30"
                >
                  <td className="px-6 py-4 font-medium text-white">
                    {contact.name || "—"}
                  </td>
                  <td className="px-6 py-4 text-zinc-300">{contact.phone}</td>
                  <td className="px-6 py-4 text-zinc-400">
                    {contact.email || "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href="/dashboard/conversas"
                      className="text-sm text-indigo-400 hover:text-indigo-300"
                    >
                      Ver conversas
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
