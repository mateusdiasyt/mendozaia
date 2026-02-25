import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { automationRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Zap } from "lucide-react";

export default async function AutomacaoPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const rules = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.organizationId, org.id))
    .orderBy(automationRules.priority);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Automação</h1>
        <p className="mt-1 text-zinc-400">
          Respostas automáticas por palavra-chave e regras
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500/20">
            <Zap className="h-7 w-7 text-amber-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">Respostas por palavra-chave</h3>
            <p className="text-sm text-zinc-400">
              Configure respostas automáticas quando o contato enviar certas
              palavras
            </p>
          </div>
        </div>

        {rules.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">
            Nenhuma regra configurada. Em breve você poderá criar regras de
            automação aqui.
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/30 p-4"
              >
                <div>
                  <p className="font-medium text-white">{rule.name}</p>
                  <p className="text-sm text-zinc-400">
                    {rule.triggerType} → {rule.actionType}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    rule.isActive ? "bg-green-500/20 text-green-400" : "bg-zinc-700 text-zinc-400"
                  }`}
                >
                  {rule.isActive ? "Ativo" : "Inativo"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
