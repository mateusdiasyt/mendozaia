"use client";

import { useState } from "react";
import { updateAiAgentConfig } from "@/app/actions/organization";
import { GEMINI_MODELS, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai-agent-constants";
import { Bot, Loader2 } from "lucide-react";

interface AiAgentFormProps {
  initialConfig: {
    enabled?: boolean;
    useAsFallback?: boolean;
    systemPrompt?: string;
    model?: string;
  };
}

export function AiAgentForm({ initialConfig }: AiAgentFormProps) {
  const [enabled, setEnabled] = useState(!!initialConfig.enabled);
  const [useAsFallback, setUseAsFallback] = useState(
    initialConfig.useAsFallback !== false
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT
  );
  const [model, setModel] = useState(
    initialConfig.model || "gemini-1.5-flash"
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await updateAiAgentConfig({
      enabled,
      useAsFallback,
      systemPrompt: systemPrompt.trim() || undefined,
      model,
    });
    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Configurações salvas com sucesso!" });
    }
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
  const labelClass = "block text-sm font-medium text-slate-700";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
          <Bot className="h-5 w-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="font-medium text-slate-900">Agente de IA (Gemini)</h3>
          <p className="text-sm text-slate-500">
            Configure o assistente para responder mensagens automaticamente
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm font-medium text-slate-700">
            Agente de IA ativo
          </span>
        </label>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={useAsFallback}
            onChange={(e) => setUseAsFallback(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm font-medium text-slate-700">
            Usar como fallback
          </span>
        </label>
        <span className="text-xs text-slate-500">
          Responde automaticamente quando nenhuma regra de automação corresponde
        </span>
      </div>

      <div>
        <label className={labelClass}>Modelo</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
        >
          {GEMINI_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Prompt do sistema</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={8}
          className={inputClass}
          placeholder="Instruções para o comportamento do assistente..."
        />
        <p className="mt-1 text-xs text-slate-500">
          Define a personalidade e instruções que a IA segue em cada resposta
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-60"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar configurações"
          )}
        </button>
      </div>
    </form>
  );
}
