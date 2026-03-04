"use client";

import { useMemo, useState } from "react";
import { updateOfferedServicesConfig } from "@/app/actions/organization";

const COMMON_MECHANIC_SERVICES = [
  "revisão preventiva",
  "troca de óleo",
  "troca de filtro de óleo",
  "troca de filtro de ar",
  "alinhamento",
  "balanceamento",
  "freios",
  "pastilha de freio",
  "disco de freio",
  "suspensão",
  "amortecedor",
  "embreagem",
  "injeção eletrônica",
  "diagnóstico com scanner",
  "bateria",
  "ar-condicionado",
  "motor",
  "câmbio",
  "correia dentada",
  "vela de ignição",
  "limpeza de bicos",
  "escapamento",
  "direção hidráulica/elétrica",
  "troca de pneus",
];

interface OfferedServicesFormProps {
  initialSelectedServices: string[];
}

export function OfferedServicesForm({
  initialSelectedServices,
}: OfferedServicesFormProps) {
  const [query, setQuery] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>(
    initialSelectedServices
  );
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const filteredServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMON_MECHANIC_SERVICES;
    return COMMON_MECHANIC_SERVICES.filter((service) =>
      service.toLowerCase().includes(q)
    );
  }, [query]);

  function toggleService(service: string) {
    const normalized = service.trim().toLowerCase();
    setSelectedServices((prev) =>
      prev.includes(normalized)
        ? prev.filter((item) => item !== normalized)
        : [...prev, normalized]
    );
  }

  function addCustomService() {
    const normalized = customInput.trim().toLowerCase();
    if (normalized.length < 2) return;
    if (!selectedServices.includes(normalized)) {
      setSelectedServices((prev) => [...prev, normalized]);
    }
    setCustomInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const result = await updateOfferedServicesConfig({
      selectedServices,
    });
    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({
      type: "success",
      text: "Serviços atendidos atualizados com sucesso.",
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Serviços que a oficina realiza</h3>
        <p className="mt-1 text-sm text-slate-500">
          Marque os serviços oferecidos. O bot usará essa lista para responder
          perguntas como “vocês fazem isso?” e, quando fizer, encaminhar para orçamento humano.
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

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label className="block text-sm font-medium text-slate-700">
          Buscar serviço
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: ar-condicionado, revisão, suspensão"
          />
        </label>

        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
          {filteredServices.map((service) => {
            const normalized = service.toLowerCase();
            const checked = selectedServices.includes(normalized);
            return (
              <label
                key={service}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-300"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleService(service)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                {service}
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Adicionar serviço personalizado</p>
        <div className="mt-2 flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: retífica de cabeçote"
          />
          <button
            type="button"
            onClick={addCustomService}
            className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Adicionar
          </button>
        </div>
      </div>

      {selectedServices.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Serviços selecionados
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedServices
              .slice()
              .sort((a, b) => a.localeCompare(b))
              .map((service) => (
                <button
                  key={service}
                  type="button"
                  onClick={() =>
                    setSelectedServices((prev) =>
                      prev.filter((item) => item !== service)
                    )
                  }
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
                  title="Remover serviço"
                >
                  {service} x
                </button>
              ))}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar serviços"}
      </button>
    </form>
  );
}

