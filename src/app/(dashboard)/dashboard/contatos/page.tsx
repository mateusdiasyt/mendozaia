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
          <h1 className="text-2xl font-semibold text-slate-900">Contatos</h1>
          <p className="mt-1 text-slate-500">
            Gerencie seus contatos e etiquetas
          </p>
        </div>
        <Link
          href="/dashboard/contatos/novo"
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-5 w-5" />
          Novo contato
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
                Nome
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
                Telefone
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">
                Email
              </th>
              <th className="px-6 py-4 text-right text-sm font-medium text-slate-600">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {orgContacts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-16 text-center text-slate-500">
                  Nenhum contato ainda. Adicione seu primeiro contato.
                </td>
              </tr>
            ) : (
              orgContacts.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b border-slate-100 transition-colors hover:bg-slate-50/50 last:border-0"
                >
                  <td className="px-6 py-4 font-medium text-slate-900">
                    {contact.name || "—"}
                  </td>
                  <td className="px-6 py-4 text-slate-600">{contact.phone}</td>
                  <td className="px-6 py-4 text-slate-500">
                    {contact.email || "—"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href="/dashboard/conversas"
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
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
