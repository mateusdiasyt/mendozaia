"use client";

import { useMemo, useState } from "react";
import { updateVehicleServicePolicyConfig } from "@/app/actions/organization";
import { BRAZIL_VEHICLE_CATALOG_MODELS } from "@/lib/vehicle-catalog-br";

interface BlockedModelYear {
  model: string;
  year: number | null;
}

interface VehicleServicePolicyFormProps {
  initialConfig: {
    minAllowedYear: number | null;
    supportedModels: string[];
    blockedModels: string[];
    blockedModelYears: BlockedModelYear[];
  };
}

function normalizeModelLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function prettifyModelLabel(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function VehicleServicePolicyForm({
  initialConfig,
}: VehicleServicePolicyFormProps) {
  const [minAllowedYear, setMinAllowedYear] = useState(
    initialConfig.minAllowedYear ? String(initialConfig.minAllowedYear) : ""
  );
  const [supportedModels, setSupportedModels] = useState<string[]>(
    (initialConfig.supportedModels ?? []).map(normalizeModelLabel).filter(Boolean)
  );
  const [blockedModels, setBlockedModels] = useState<string[]>(
    (initialConfig.blockedModels ?? []).map(normalizeModelLabel).filter(Boolean)
  );
  const [blockedModelYears, setBlockedModelYears] = useState<BlockedModelYear[]>(
    (initialConfig.blockedModelYears ?? [])
      .map((item) => ({
        model: normalizeModelLabel(item.model),
        year:
          typeof item.year === "number" && Number.isFinite(item.year)
            ? Math.trunc(item.year)
            : null,
      }))
      .filter((item) => item.model.length >= 2)
  );
  const [supportedModelInput, setSupportedModelInput] = useState("");
  const [blockedModelInput, setBlockedModelInput] = useState("");
  const [blockedYearModelInput, setBlockedYearModelInput] = useState("");
  const [blockedYearInput, setBlockedYearInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const normalizedSupportedInput = normalizeModelLabel(supportedModelInput);
  const normalizedBlockedInput = normalizeModelLabel(blockedModelInput);
  const normalizedBlockedYearModelInput = normalizeModelLabel(blockedYearModelInput);

  const canAddSupportedModel = normalizedSupportedInput.length >= 2;
  const canAddBlockedModel = normalizedBlockedInput.length >= 2;
  const parsedBlockedYear = blockedYearInput.trim() ? Number(blockedYearInput) : null;
  const canAddBlockedModelYear =
    normalizedBlockedYearModelInput.length >= 2 &&
    !!parsedBlockedYear &&
    parsedBlockedYear >= 1980 &&
    parsedBlockedYear <= 2035;

  const sortedSupportedModels = useMemo(
    () => [...supportedModels].sort((a, b) => a.localeCompare(b)),
    [supportedModels]
  );
  const sortedBlockedModels = useMemo(
    () => [...blockedModels].sort((a, b) => a.localeCompare(b)),
    [blockedModels]
  );
  const sortedBlockedModelYears = useMemo(
    () =>
      [...blockedModelYears].sort((a, b) => {
        const byModel = a.model.localeCompare(b.model);
        if (byModel !== 0) return byModel;
        return (a.year ?? 0) - (b.year ?? 0);
      }),
    [blockedModelYears]
  );

  const visibleSupportedModels = sortedSupportedModels.slice(0, 120);
  const hiddenSupportedCount = Math.max(0, sortedSupportedModels.length - visibleSupportedModels.length);

  function addSupportedModel() {
    if (!canAddSupportedModel) return;
    if (supportedModels.some((model) => model === normalizedSupportedInput)) {
      setMessage({ type: "error", text: "Esse modelo ja esta na lista de atendidos." });
      return;
    }
    setSupportedModels((prev) => [...prev, normalizedSupportedInput]);
    setSupportedModelInput("");
    setMessage(null);
  }

  function loadBrazilCatalogAsSupported() {
    setSupportedModels(BRAZIL_VEHICLE_CATALOG_MODELS.map(normalizeModelLabel));
    setMessage({
      type: "success",
      text: `Catalogo Brasil carregado com ${BRAZIL_VEHICLE_CATALOG_MODELS.length} modelos.`,
    });
  }

  function addBlockedModel() {
    if (!canAddBlockedModel) return;
    if (blockedModels.some((m) => m === normalizedBlockedInput)) {
      setMessage({ type: "error", text: "Esse modelo ja esta na lista de bloqueio." });
      return;
    }
    setBlockedModels((prev) => [...prev, normalizedBlockedInput]);
    setBlockedModelInput("");
    setMessage(null);
  }

  function addBlockedModelYear() {
    if (!canAddBlockedModelYear || !parsedBlockedYear) return;
    const exists = blockedModelYears.some(
      (item) =>
        item.model === normalizedBlockedYearModelInput &&
        item.year === parsedBlockedYear
    );
    if (exists) {
      setMessage({
        type: "error",
        text: "Esse modelo/ano ja esta na lista de bloqueio especifico.",
      });
      return;
    }
    setBlockedModelYears((prev) => [
      ...prev,
      { model: normalizedBlockedYearModelInput, year: parsedBlockedYear },
    ]);
    setBlockedYearModelInput("");
    setBlockedYearInput("");
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const minYearNumber = minAllowedYear.trim() ? Number(minAllowedYear) : null;
    if (
      minYearNumber !== null &&
      (!Number.isFinite(minYearNumber) || minYearNumber < 1980 || minYearNumber > 2035)
    ) {
      setSaving(false);
      setMessage({
        type: "error",
        text: "Ano minimo invalido. Informe um ano entre 1980 e 2035.",
      });
      return;
    }

    const result = await updateVehicleServicePolicyConfig({
      minAllowedYear: minYearNumber ? Math.trunc(minYearNumber) : null,
      supportedModels,
      blockedModels,
      blockedModelYears,
    });

    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({
      type: "success",
      text: "Politica de veiculos salva com sucesso.",
    });
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Politica de veiculos atendidos</h3>
        <p className="mt-1 text-sm text-slate-500">
          Configure quais modelos a oficina atende usando a tabela de veiculos do Brasil.
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

      <datalist id="vehicle-model-suggestions">
        {BRAZIL_VEHICLE_CATALOG_MODELS.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-700">Veiculos (tabela Brasil)</p>
            <p className="mt-1 text-xs text-slate-500">
              Selecione os modelos atendidos. O agente usa essa tabela quando o cliente informa o carro.
            </p>
          </div>
          <div className="text-xs font-medium text-slate-600">
            {sortedSupportedModels.length} modelo(s) atendido(s)
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            list="vehicle-model-suggestions"
            value={supportedModelInput}
            onChange={(e) => setSupportedModelInput(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: Onix"
          />
          <button
            type="button"
            onClick={addSupportedModel}
            disabled={!canAddSupportedModel}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Adicionar
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadBrazilCatalogAsSupported}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            Carregar catalogo Brasil ({BRAZIL_VEHICLE_CATALOG_MODELS.length})
          </button>
          <button
            type="button"
            onClick={() => setSupportedModels([])}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Limpar atendidos
          </button>
        </div>

        {visibleSupportedModels.length > 0 && (
          <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto pr-1">
            {visibleSupportedModels.map((model) => (
              <button
                key={model}
                type="button"
                onClick={() =>
                  setSupportedModels((prev) => prev.filter((m) => m !== model))
                }
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                title="Remover modelo atendido"
              >
                {prettifyModelLabel(model)} x
              </button>
            ))}
          </div>
        )}
        {hiddenSupportedCount > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Mostrando os primeiros 120 modelos. Existem mais {hiddenSupportedCount} modelo(s) na lista.
          </p>
        )}
      </div>

      <label className="block text-sm font-medium text-slate-700">
        Ano minimo atendido (opcional)
        <input
          type="number"
          min={1980}
          max={2035}
          value={minAllowedYear}
          onChange={(e) => setMinAllowedYear(e.target.value)}
          className={inputClass}
          placeholder="Ex.: 2019"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Exemplo: 2019 bloqueia automaticamente veiculos abaixo de 2019.
        </span>
      </label>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Bloqueio por modelo</p>
        <p className="mt-1 text-xs text-slate-500">
          Use para excecoes (mesmo que o modelo esteja na lista de atendidos).
        </p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            list="vehicle-model-suggestions"
            value={blockedModelInput}
            onChange={(e) => setBlockedModelInput(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: Ranger"
          />
          <button
            type="button"
            onClick={addBlockedModel}
            disabled={!canAddBlockedModel}
            className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Adicionar bloqueio
          </button>
        </div>
        {sortedBlockedModels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sortedBlockedModels.map((model) => (
              <button
                key={model}
                type="button"
                onClick={() =>
                  setBlockedModels((prev) =>
                    prev.filter((m) => m !== model)
                  )
                }
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700 hover:bg-rose-100"
                title="Remover modelo bloqueado"
              >
                {prettifyModelLabel(model)} x
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Bloqueio por modelo + ano</p>
        <p className="mt-1 text-xs text-slate-500">
          Use para casos especificos, como "Ranger 2022".
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_160px_auto]">
          <input
            type="text"
            list="vehicle-model-suggestions"
            value={blockedYearModelInput}
            onChange={(e) => setBlockedYearModelInput(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: Ranger"
          />
          <input
            type="number"
            min={1980}
            max={2035}
            value={blockedYearInput}
            onChange={(e) => setBlockedYearInput(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ano"
          />
          <button
            type="button"
            onClick={addBlockedModelYear}
            disabled={!canAddBlockedModelYear}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Adicionar
          </button>
        </div>
        {sortedBlockedModelYears.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sortedBlockedModelYears.map((item) => (
              <button
                key={`${item.model}-${item.year}`}
                type="button"
                onClick={() =>
                  setBlockedModelYears((prev) =>
                    prev.filter(
                      (entry) =>
                        !(
                          entry.model === item.model &&
                          entry.year === item.year
                        )
                    )
                  )
                }
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100"
                title="Remover excecao"
              >
                {prettifyModelLabel(item.model)} {item.year} x
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar politica de veiculos"}
      </button>
    </form>
  );
}

