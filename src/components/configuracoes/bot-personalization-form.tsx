"use client";

import { useState } from "react";
import { updateBotPersonalizationConfig } from "@/app/actions/organization";

interface BotPersonalizationFormProps {
  initialConfig: {
    segment: "mecanica" | "restaurante" | "geral";
    tone: "formal" | "neutro" | "casual";
    language: string;
    useAIFallback: boolean;
  };
}

export function BotPersonalizationForm({
  initialConfig,
}: BotPersonalizationFormProps) {
  const [segment, setSegment] = useState(initialConfig.segment);
  const [tone, setTone] = useState(initialConfig.tone);
  const [language, setLanguage] = useState(initialConfig.language);
  const [useAIFallback, setUseAIFallback] = useState(initialConfig.useAIFallback);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await updateBotPersonalizationConfig({
      segment,
      tone,
      language: language.trim() || "pt-BR",
      useAIFallback,
    });
    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({
      type: "success",
      text: "Personalização do bot salva com sucesso.",
    });
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Personalização do bot</h3>
        <p className="mt-1 text-sm text-slate-500">
          Define segmento e estilo sem depender de prompt para regras centrais.
        </p>
      </div>

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

      <label className="block text-sm font-medium text-slate-700">
        Segmento
        <select
          value={segment}
          onChange={(e) =>
            setSegment(e.target.value as "mecanica" | "restaurante" | "geral")
          }
          className={inputClass}
        >
          <option value="mecanica">Mecânica</option>
          <option value="restaurante">Restaurante</option>
          <option value="geral">Geral</option>
        </select>
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Tom de voz
        <select
          value={tone}
          onChange={(e) =>
            setTone(e.target.value as "formal" | "neutro" | "casual")
          }
          className={inputClass}
        >
          <option value="formal">Formal</option>
          <option value="neutro">Neutro</option>
          <option value="casual">Casual</option>
        </select>
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Idioma
        <input
          type="text"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className={inputClass}
          placeholder="pt-BR"
        />
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={useAIFallback}
          onChange={(e) => setUseAIFallback(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Usar IA como fallback (opcional)
      </label>

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar personalização"}
      </button>
    </form>
  );
}
