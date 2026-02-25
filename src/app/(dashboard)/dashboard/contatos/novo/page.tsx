import { getCurrentOrganization } from "@/lib/auth-utils";
import { CreateContactForm } from "@/components/contacts/create-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function NovoContatoPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  return (
    <div className="p-8">
      <Link
        href="/dashboard/contatos"
        className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <div className="max-w-md">
        <h1 className="text-2xl font-semibold text-white">Novo contato</h1>
        <p className="mt-1 text-zinc-400">Adicione um novo contato à sua lista</p>

        <CreateContactForm organizationId={org.id} className="mt-6" />
      </div>
    </div>
  );
}
