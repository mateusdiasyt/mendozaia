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
          <h1 className="text-2xl font-semibold text-slate-900">Automação</h1>
          <p className="mt-1 text-slate-500">
            Gatilhos, condições e ações. Simples e escalável.
          </p>
        </div>
        <Link
          href="/dashboard/automacao/nova"
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          <Plus className="h-5 w-5" />
          Nova regra
        </Link>
      </div>

      <div className="space-y-4">
        {rules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
              <Zap className="h-7 w-7 text-slate-500" />
            </div>
            <h3 className="mt-4 font-medium text-slate-700">
              Nenhuma regra configurada
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Crie sua primeira regra de automação para respostas automáticas,
              follow-ups e mais.
            </p>
            <Link
              href="/dashboard/automacao/nova"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
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
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-medium text-slate-900">{rule.name}</h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        rule.isActive
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {rule.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatRuleDescription(
                      rule.triggerType as TriggerType,
                      rule.conditionType as ConditionType,
                      rule.conditionValue as Record<string, unknown>,
                      rule.actionType as ActionType,
                      rule.actionPayload as Record<string, unknown>
                    )}
                    {tagName && (
                      <span className="ml-1 text-indigo-600">({tagName})</span>
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
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
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

      <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-medium text-slate-900">Tipos de automação</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
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
