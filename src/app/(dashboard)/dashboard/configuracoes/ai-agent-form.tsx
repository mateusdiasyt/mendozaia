"use client";

import { useState } from "react";
import { updateAiAgentConfig, testAiAgentConnection } from "@/app/actions/organization";
import { GEMINI_MODELS, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai-agent-constants";
import { PROMPT_TEMPLATES, PROMPT_TEMPLATE_CATEGORIES } from "@/lib/prompt-templates";
import { Bot, Loader2, Trash2, FileText } from "lucide-react";

interface AiAgentFormProps {
  initialConfig: {
    enabled?: boolean;
    useAsFallback?: boolean;
    systemPrompt?: string;
    model?: string;
    /** Indica se já existe chave configurada (nunca enviamos a chave real ao client) */
    hasApiKey?: boolean;
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
  const [model, setModel] = useState(() => {
    const saved = initialConfig.model;
    return saved && (GEMINI_MODELS as readonly string[]).includes(saved)
      ? saved
      : "gemini-2.0-flash";
  });
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
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
      ...(apiKey.trim() !== "" && { apiKey: apiKey.trim() }),
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
        <label className={labelClass}>Chave da API Gemini</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className={inputClass}
          placeholder={initialConfig.hasApiKey ? "•••••••• (deixe em branco para manter)" : "Cole sua chave da API Gemini"}
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-slate-500">
          Obtenha em{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:underline"
          >
            Google AI Studio
          </a>
          . A chave fica salva de forma segura na sua organização.
        </p>
        {initialConfig.hasApiKey && (
          <button
            type="button"
            onClick={async () => {
              setSaving(true);
              setMessage(null);
              const result = await updateAiAgentConfig({ apiKey: "" });
              setSaving(false);
              if (result?.error) {
                setMessage({ type: "error", text: result.error });
              } else {
                setMessage({ type: "success", text: "Chave removida." });
              }
            }}
            disabled={saving}
            className="mt-2 inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remover chave
          </button>
        )}
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
        <label className={labelClass}>Templates de prompt</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              e.target.value = "";
              const template = PROMPT_TEMPLATES.find((t) => t.id === id);
              if (!template) return;
              if (systemPrompt.trim() && !confirm("Substituir o prompt atual pelo template?"))
                return;
              setSystemPrompt(template.prompt);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Usar template...</option>
            {PROMPT_TEMPLATE_CATEGORIES.map((cat) => (
              <optgroup key={cat} label={cat}>
                {PROMPT_TEMPLATES.filter((t) => t.category === cat).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.description}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <FileText className="h-3.5 w-3.5" />
            Escolha um template e substitua [NOME], [CIDADE], [VEICULOS_ATENDIDOS] etc.
          </span>
        </div>
      </div>

      <div>
        <label className={labelClass}>Prompt do sistema</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={12}
          className={inputClass}
          placeholder="Instruções para o comportamento do assistente..."
        />
        <p className="mt-1 text-xs text-slate-500">
          Define a personalidade e instruções que a IA segue em cada resposta
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
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
        <button
          type="button"
          disabled={saving || testing}
          onClick={async () => {
            setTesting(true);
            setTestResult(null);
            setMessage(null);
            const result = await testAiAgentConnection();
            setTesting(false);
            if (result?.error) {
              setMessage({ type: "error", text: result.error });
            } else if (result?.reply) {
              setTestResult(result.reply);
              setMessage({ type: "success", text: "Conexão com a IA funcionando!" });
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          {testing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Testando...
            </>
          ) : (
            "Testar IA"
          )}
        </button>
      </div>

      {testResult && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Resposta de teste:</p>
          <p className="mt-2 text-slate-600">{testResult}</p>
        </div>
      )}
    </form>
  );
}
