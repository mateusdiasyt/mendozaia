import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";

export default async function ConfiguracoesPage() {
  const session = await auth();
  const org = await getCurrentOrganization();
  if (!org) return null;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Configurações</h1>
        <p className="mt-1 text-slate-500">
          Gerencie sua conta e organização
        </p>
      </div>

      <div className="space-y-6 max-w-2xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">Sua conta</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Nome</dt>
              <dd className="font-medium text-slate-900">{session?.user?.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium text-slate-900">{session?.user?.email}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">Organização</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Nome</dt>
              <dd className="font-medium text-slate-900">{org.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Plano</dt>
              <dd className="font-medium capitalize text-slate-900">{org.plan}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
