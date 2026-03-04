"use client";

import { useMemo, useState } from "react";
import { updateVehicleServicePolicyConfig } from "@/app/actions/organization";

interface BlockedModelYear {
  model: string;
  year: number | null;
}

interface VehicleServicePolicyFormProps {
  initialConfig: {
    minAllowedYear: number | null;
    blockedModels: string[];
    blockedModelYears: BlockedModelYear[];
  };
}

const COMMON_MODELS = [
  "Onix",
  "Palio",
  "Uno",
  "Gol",
  "Saveiro",
  "Voyage",
  "Fox",
  "Polo",
  "HB20",
  "Creta",
  "Kwid",
  "Sandero",
  "Logan",
  "Duster",
  "Fiesta",
  "Focus",
  "Ka",
  "Ranger",
  "S10",
  "Hilux",
  "Corolla",
  "Yaris",
  "Civic",
  "City",
  "Fit",
  "Compass",
  "Renegade",
  "Toro",
  "Cruze",
  "Tracker",
];

export function VehicleServicePolicyForm({
  initialConfig,
}: VehicleServicePolicyFormProps) {
  const [minAllowedYear, setMinAllowedYear] = useState(
    initialConfig.minAllowedYear ? String(initialConfig.minAllowedYear) : ""
  );
  const [blockedModels, setBlockedModels] = useState<string[]>(
    initialConfig.blockedModels ?? []
  );
  const [blockedModelYears, setBlockedModelYears] = useState<BlockedModelYear[]>(
    initialConfig.blockedModelYears ?? []
  );
  const [modelInput, setModelInput] = useState("");
  const [yearInput, setYearInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const normalizedModelInput = modelInput.trim().toLowerCase();
  const canAddModel = normalizedModelInput.length >= 2;
  const parsedYear = yearInput.trim() ? Number(yearInput) : null;
  const canAddModelYear = canAddModel && !!parsedYear && parsedYear >= 1980 && parsedYear <= 2035;

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

  function clearInputs() {
    setModelInput("");
    setYearInput("");
  }

  function addBlockedModel() {
    if (!canAddModel) return;
    if (blockedModels.some((m) => m.toLowerCase() === normalizedModelInput)) {
      setMessage({ type: "error", text: "Esse modelo já está na lista de bloqueio." });
      return;
    }
    setBlockedModels((prev) => [...prev, normalizedModelInput]);
    setMessage(null);
    clearInputs();
  }

  function addBlockedModelYear() {
    if (!canAddModelYear || !parsedYear) return;
    const exists = blockedModelYears.some(
      (item) =>
        item.model.toLowerCase() === normalizedModelInput &&
        item.year === parsedYear
    );
    if (exists) {
      setMessage({
        type: "error",
        text: "Esse modelo/ano já está na lista de bloqueio específico.",
      });
      return;
    }
    setBlockedModelYears((prev) => [
      ...prev,
      { model: normalizedModelInput, year: parsedYear },
    ]);
    setMessage(null);
    clearInputs();
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
        text: "Ano mínimo inválido. Informe um ano entre 1980 e 2035.",
      });
      return;
    }

    const result = await updateVehicleServicePolicyConfig({
      minAllowedYear: minYearNumber ? Math.trunc(minYearNumber) : null,
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
      text: "Política de atendimento por veículo salva com sucesso.",
    });
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Política de veículos atendidos</h3>
        <p className="mt-1 text-sm text-slate-500">
          Defina regras para veículos que sua oficina não atende (por ano e por modelo).
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
        Ano mínimo atendido (opcional)
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
          Exemplo: 2019 bloqueia automaticamente veículos abaixo de 2019.
        </span>
      </label>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Bloqueio por modelo</p>
        <p className="mt-1 text-xs text-slate-500">
          Digite um modelo e adicione para bloquear qualquer ano desse modelo.
        </p>
        <datalist id="vehicle-model-suggestions">
          {COMMON_MODELS.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            list="vehicle-model-suggestions"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: Ranger"
          />
          <button
            type="button"
            onClick={addBlockedModel}
            disabled={!canAddModel}
            className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Adicionar modelo
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
                    prev.filter((m) => m.toLowerCase() !== model.toLowerCase())
                  )
                }
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700 hover:bg-rose-100"
                title="Remover modelo"
              >
                {model} x
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Bloqueio por modelo + ano</p>
        <p className="mt-1 text-xs text-slate-500">
          Use para exceções específicas, como “Ranger 2022”.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_160px_auto]">
          <input
            type="text"
            list="vehicle-model-suggestions"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: Ranger"
          />
          <input
            type="number"
            min={1980}
            max={2035}
            value={yearInput}
            onChange={(e) => setYearInput(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ano"
          />
          <button
            type="button"
            onClick={addBlockedModelYear}
            disabled={!canAddModelYear}
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
                          entry.model.toLowerCase() === item.model.toLowerCase() &&
                          entry.year === item.year
                        )
                    )
                  )
                }
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100"
                title="Remover exceção"
              >
                {item.model} {item.year} x
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
        {saving ? "Salvando..." : "Salvar política de veículos"}
      </button>
    </form>
  );
}

