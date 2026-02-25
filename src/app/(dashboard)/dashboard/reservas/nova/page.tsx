import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { CreateReservationForm } from "@/components/reservations/create-reservation-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function NovaReservaPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const settings = (org.settings as Record<string, unknown>) ?? {};
  if (!settings.reservationsEnabled) {
    return (
      <div className="p-8">
        <p className="text-slate-600">
          O sistema de reservas não está ativado. Ative em{" "}
          <Link
            href="/dashboard/configuracoes"
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            Configurações
          </Link>
          .
        </p>
      </div>
    );
  }

  const orgContacts = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.organizationId, org.id))
    .orderBy(contacts.name);

  return (
    <div className="p-8">
      <Link
        href="/dashboard/reservas"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <div className="max-w-md">
        <h1 className="text-2xl font-semibold text-slate-900">Nova reserva</h1>
        <p className="mt-1 text-slate-500">
          Preencha os dados para criar uma reserva
        </p>

        <CreateReservationForm contacts={orgContacts} className="mt-6" />
      </div>
    </div>
  );
}
