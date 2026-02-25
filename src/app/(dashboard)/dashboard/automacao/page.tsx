import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { automationRules, tags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Zap, Plus } from "lucide-react";
import Link from "next/link";
import {
  TRIGGER_LABELS,
  CONDITION_LABELS,
  ACTION_LABELS,
} from "@/lib/automation/labels";
import type { TriggerType, ConditionType, ActionType } from "@/lib/automation/types";
import { ToggleRuleButton } from "./toggle-rule";
import { DeleteRuleButton } from "./delete-rule";

function formatRuleDescription(
  trigger: TriggerType,
  condition: ConditionType,
  conditionValue: Record<string, unknown> | null,
  action: ActionType,
  actionPayload: Record<string, unknown> | null
) {
  const cond =
    condition === "keyword_contains" && conditionValue?.keywords
      ? `"${(conditionValue.keywords as string[]).join(", ")}"`
      : condition === "minutes_without_reply" && conditionValue?.minutes
        ? `${conditionValue.minutes} min`
        : CONDITION_LABELS[condition as ConditionType];

  const act =
    action === "reply" && actionPayload?.message
      ? `"${(actionPayload.message as string).slice(0, 40)}..."`
      : action === "add_tag" && actionPayload?.tagId
        ? `tag ${actionPayload.tagId}`
        : ACTION_LABELS[action as ActionType];

  return `${TRIGGER_LABELS[trigger as TriggerType]} + ${cond} → ${act}`;
}

export default async function AutomacaoPage() {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const rules = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.organizationId, org.id))
    .orderBy(automationRules.priority);

  const orgTags = await db
    .select()
    .from(tags)
    .where(eq(tags.organizationId, org.id));

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Automação</h1>
          <p className="mt-1 text-zinc-400">
            Gatilhos, condições e ações. Sem construtor visual — simples e
            escalável.
          </p>
        </div>
        <Link
          href="/dashboard/automacao/nova"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-5 w-5" />
          Nova regra
        </Link>
      </div>

      <div className="space-y-4">
        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 p-12 text-center">
            <Zap className="mx-auto h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 font-medium text-zinc-300">
              Nenhuma regra configurada
            </h3>
            <p className="mt-2 text-sm text-zinc-500">
              Crie sua primeira regra de automação para respostas automáticas,
              follow-ups e mais.
            </p>
            <Link
              href="/dashboard/automacao/nova"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-4 w-4" />
              Nova regra
            </Link>
          </div>
        ) : (
          rules.map((rule) => {
            const tagName =
              rule.actionType === "add_tag" && rule.actionPayload?.tagId
                ? orgTags.find((t) => t.id === rule.actionPayload?.tagId)?.name
                : null;
            return (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-medium text-white">{rule.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        rule.isActive
                          ? "bg-green-500/20 text-green-400"
                          : "bg-zinc-700 text-zinc-400"
                      }`}
                    >
                      {rule.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">
                    {formatRuleDescription(
                      rule.triggerType as TriggerType,
                      rule.conditionType as ConditionType,
                      rule.conditionValue as Record<string, unknown>,
                      rule.actionType as ActionType,
                      rule.actionPayload as Record<string, unknown>
                    )}
                    {tagName && (
                      <span className="ml-1 text-indigo-400">({tagName})</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ToggleRuleButton
                    id={rule.id}
                    isActive={rule.isActive}
                  />
                  <Link
                    href={`/dashboard/automacao/${rule.id}/editar`}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Editar
                  </Link>
                  <DeleteRuleButton id={rule.id} />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-12 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
        <h3 className="font-medium text-zinc-300">Tipos de automação (MVP)</h3>
        <ul className="mt-3 space-y-2 text-sm text-zinc-400">
          <li>• Resposta automática por palavra-chave</li>
          <li>• Mensagem fora do horário comercial</li>
          <li>• Follow-up após X minutos sem resposta</li>
          <li>• Aplicar etiqueta automaticamente</li>
          <li>• Transferir para atendente humano</li>
        </ul>
      </div>
    </div>
  );
}
