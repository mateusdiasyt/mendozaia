"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAutomationRule, updateAutomationRule } from "@/app/actions/automation";
import {
  TRIGGER_LABELS,
  CONDITION_LABELS,
  ACTION_LABELS,
} from "@/lib/automation/labels";
import {
  TRIGGER_TYPES,
  CONDITION_TYPES,
  ACTION_TYPES,
} from "@/lib/automation/types";
import type { TriggerType, ConditionType, ActionType } from "@/lib/automation/types";
import type { tags } from "@/lib/db/schema";

type Tag = typeof tags.$inferSelect;

interface RuleFormProps {
  organizationId: string;
  tags: Tag[];
  rule?: {
    id: string;
    name: string;
    triggerType: string;
    conditionType: string;
    conditionValue: Record<string, unknown> | null;
    actionType: string;
    actionPayload: Record<string, unknown> | null;
    priority: number;
  };
}

export function RuleForm({ organizationId, tags, rule }: RuleFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(rule?.name ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(
    (rule?.triggerType as TriggerType) ?? TRIGGER_TYPES.MESSAGE_RECEIVED
  );
  const [conditionType, setConditionType] = useState<ConditionType>(
    (rule?.conditionType as ConditionType) ?? CONDITION_TYPES.NONE
  );
  const [conditionValue, setConditionValue] = useState<
    Record<string, unknown>
  >(
    (rule?.conditionValue as Record<string, unknown>) ?? {}
  );
  const [actionType, setActionType] = useState<ActionType>(
    (rule?.actionType as ActionType) ?? ACTION_TYPES.REPLY
  );
  const [actionPayload, setActionPayload] = useState<
    Record<string, unknown>
  >(
    (rule?.actionPayload as Record<string, unknown>) ?? {}
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let finalConditionValue: Record<string, unknown> = { ...conditionValue };
    let finalActionPayload: Record<string, unknown> = { ...actionPayload };

    if (conditionType === CONDITION_TYPES.KEYWORD_CONTAINS) {
      const raw = typeof conditionValue.keywords === "string"
        ? conditionValue.keywords
        : (conditionValue.keywords as string[])?.join(", ") ?? "";
      const keywords = raw.split(",").map((k) => k.trim()).filter(Boolean);
      if (!keywords.length) {
        setError("Informe pelo menos uma palavra-chave");
        return;
      }
      finalConditionValue = { keywords };
    }

    if (conditionType === CONDITION_TYPES.MINUTES_WITHOUT_REPLY) {
      finalConditionValue = {
        minutes: Number(conditionValue.minutes) || 30,
      };
    }

    if (actionType === ACTION_TYPES.REPLY) {
      const message = (actionPayload.message as string)?.trim();
      if (!message) {
        setError("Informe a mensagem de resposta");
        return;
      }
      finalActionPayload = { message };
    }

    if (actionType === ACTION_TYPES.ADD_TAG) {
      const tagId = actionPayload.tagId as string;
      if (!tagId) {
        setError("Selecione uma etiqueta");
        return;
      }
      finalActionPayload = { tagId };
    }

    if (rule) {
      const result = await updateAutomationRule(rule.id, {
        name: name.trim(),
        triggerType,
        conditionType,
        conditionValue: finalConditionValue,
        actionType,
        actionPayload: finalActionPayload,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
    } else {
      const result = await createAutomationRule({
        name: name.trim(),
        triggerType,
        conditionType,
        conditionValue: finalConditionValue,
        actionType,
        actionPayload: finalActionPayload,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
    }

    router.push("/dashboard/automacao");
    router.refresh();
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
  const labelClass = "block text-sm font-medium text-slate-700";

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div>
        <label className={labelClass}>Nome da regra *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder="Ex: Resposta para 'olá'"
        />
      </div>

      <div>
        <label className={labelClass}>Gatilho</label>
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as TriggerType)}
          className={inputClass}
        >
          {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Condição</label>
        <select
          value={conditionType}
          onChange={(e) =>
            setConditionType(e.target.value as ConditionType)
          }
          className={inputClass}
        >
          {Object.entries(CONDITION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        {conditionType === CONDITION_TYPES.KEYWORD_CONTAINS && (
          <input
            type="text"
            value={
              Array.isArray(conditionValue.keywords)
                ? (conditionValue.keywords as string[]).join(", ")
                : (conditionValue.keywords as string) ?? ""
            }
            onChange={(e) =>
              setConditionValue({
                keywords: e.target.value.split(",").map((k) => k.trim()),
              })
            }
            className={inputClass}
            placeholder="olá, oi, bom dia (separados por vírgula)"
          />
        )}

        {conditionType === CONDITION_TYPES.OUTSIDE_BUSINESS_HOURS && (
          <p className="mt-2 text-sm text-slate-500">
            Configure o horário comercial nas configurações da organização
            (settings.businessHours).
          </p>
        )}

        {conditionType === CONDITION_TYPES.MINUTES_WITHOUT_REPLY && (
          <input
            type="number"
            min={1}
            value={(conditionValue.minutes as number) ?? 30}
            onChange={(e) =>
              setConditionValue({ minutes: Number(e.target.value) || 30 })
            }
            className={inputClass}
            placeholder="30"
          />
        )}
      </div>

      <div>
        <label className={labelClass}>Ação</label>
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value as ActionType)}
          className={inputClass}
        >
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        {actionType === ACTION_TYPES.REPLY && (
          <textarea
            value={(actionPayload.message as string) ?? ""}
            onChange={(e) =>
              setActionPayload({ ...actionPayload, message: e.target.value })
            }
            rows={4}
            className={inputClass}
            placeholder="Mensagem automática..."
          />
        )}

        {actionType === ACTION_TYPES.ADD_TAG && (
          <select
            value={(actionPayload.tagId as string) ?? ""}
            onChange={(e) =>
              setActionPayload({ ...actionPayload, tagId: e.target.value })
            }
            className={inputClass}
          >
            <option value="">Selecione uma etiqueta</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
        >
          {rule ? "Salvar" : "Criar regra"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
