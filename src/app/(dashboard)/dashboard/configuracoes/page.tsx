import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";

export default async function ConfiguracoesPage() {
  const session = await auth();
  const org = await getCurrentOrganization();
  if (!org) return null;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Configurações</h1>
        <p className="mt-1 text-zinc-400">
          Gerencie sua conta e organização
        </p>
      </div>

      <div className="space-y-8 max-w-2xl">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="font-medium text-white">Sua conta</h3>
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-zinc-500">Nome</dt>
              <dd className="text-white">{session?.user?.name}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Email</dt>
              <dd className="text-white">{session?.user?.email}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="font-medium text-white">Organização</h3>
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-zinc-500">Nome</dt>
              <dd className="text-white">{org.name}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Plano</dt>
              <dd className="text-white capitalize">{org.plan}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
