"use client";

import { useEffect, useMemo, useState } from "react";
import { updateVehicleServicePolicyConfig } from "@/app/actions/organization";
import { BRAZIL_VEHICLE_CATALOG_MODELS } from "@/lib/vehicle-catalog-br";

interface VehicleServicePolicyFormProps {
  initialConfig: {
    minAllowedYear: number | null;
    supportedModels: string[];
    blockedModels: string[];
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
  const [supportedModelInput, setSupportedModelInput] = useState("");
  const [blockedModelInput, setBlockedModelInput] = useState("");
  const [supportedSearch, setSupportedSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showOnlySelectedInCatalog, setShowOnlySelectedInCatalog] = useState(false);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const catalogModelsNormalized = useMemo(
    () =>
      BRAZIL_VEHICLE_CATALOG_MODELS.map((model) => ({
        raw: model,
        normalized: normalizeModelLabel(model),
      })),
    []
  );

  const catalogSet = useMemo(
    () => new Set(catalogModelsNormalized.map((item) => item.normalized)),
    [catalogModelsNormalized]
  );

  const supportedSet = useMemo(() => new Set(supportedModels), [supportedModels]);

  useEffect(() => {
    // Sincroniza bloqueios com os modelos cadastrados em "veiculos atendidos".
    setBlockedModels((prev) => prev.filter((model) => supportedSet.has(model)));
  }, [supportedSet]);

  const normalizedSupportedInput = normalizeModelLabel(supportedModelInput);
  const normalizedBlockedInput = normalizeModelLabel(blockedModelInput);
  const normalizedSupportedSearch = normalizeModelLabel(supportedSearch);
  const normalizedCatalogSearch = normalizeModelLabel(catalogSearch);

  const sortedSupportedModels = useMemo(
    () => [...supportedModels].sort((a, b) => a.localeCompare(b)),
    [supportedModels]
  );
  const sortedBlockedModels = useMemo(
    () => [...blockedModels].sort((a, b) => a.localeCompare(b)),
    [blockedModels]
  );

  const filteredSupportedModels = useMemo(() => {
    if (!normalizedSupportedSearch) return sortedSupportedModels;
    return sortedSupportedModels.filter((model) =>
      model.includes(normalizedSupportedSearch)
    );
  }, [normalizedSupportedSearch, sortedSupportedModels]);

  const catalogResults = useMemo(() => {
    let source = catalogModelsNormalized;

    if (normalizedCatalogSearch) {
      source = source.filter((item) => item.normalized.includes(normalizedCatalogSearch));
    }
    if (showOnlySelectedInCatalog) {
      source = source.filter((item) => supportedSet.has(item.normalized));
    }
    return source;
  }, [
    catalogModelsNormalized,
    normalizedCatalogSearch,
    showOnlySelectedInCatalog,
    supportedSet,
  ]);

  const canAddSupportedModel =
    normalizedSupportedInput.length >= 2 && catalogSet.has(normalizedSupportedInput);
  const canAddBlockedModel =
    normalizedBlockedInput.length >= 2 && supportedSet.has(normalizedBlockedInput);

  function addSupportedModel() {
    if (!normalizedSupportedInput || normalizedSupportedInput.length < 2) return;
    if (!catalogSet.has(normalizedSupportedInput)) {
      setMessage({
        type: "error",
        text: "Esse modelo nao existe no catalogo Brasil.",
      });
      return;
    }
    if (supportedSet.has(normalizedSupportedInput)) {
      setMessage({ type: "error", text: "Esse modelo ja esta cadastrado." });
      return;
    }
    setSupportedModels((prev) => [...prev, normalizedSupportedInput]);
    setSupportedModelInput("");
    setMessage(null);
  }

  function toggleSupportedModel(model: string) {
    if (supportedSet.has(model)) {
      setSupportedModels((prev) => prev.filter((item) => item !== model));
      return;
    }
    setSupportedModels((prev) => [...prev, model]);
  }

  function loadBrazilCatalogAsSupported() {
    const allModels = catalogModelsNormalized.map((item) => item.normalized);
    setSupportedModels(allModels);
    setMessage({
      type: "success",
      text: `Catalogo Brasil carregado com ${allModels.length} modelos.`,
    });
  }

  function clearSupportedModels() {
    setSupportedModels([]);
    setBlockedModels([]);
    setMessage({
      type: "success",
      text: "Lista de veiculos atendidos limpa.",
    });
  }

  function addBlockedModel() {
    if (!canAddBlockedModel) {
      setMessage({
        type: "error",
        text: "Bloqueio por modelo so aceita modelos que ja estao em veiculos atendidos.",
      });
      return;
    }
    if (blockedModels.some((model) => model === normalizedBlockedInput)) {
      setMessage({ type: "error", text: "Esse modelo ja esta bloqueado." });
      return;
    }
    setBlockedModels((prev) => [...prev, normalizedBlockedInput]);
    setBlockedModelInput("");
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

    const syncedBlocked = blockedModels.filter((model) => supportedSet.has(model));
    if (syncedBlocked.length !== blockedModels.length) {
      setBlockedModels(syncedBlocked);
    }

    const result = await updateVehicleServicePolicyConfig({
      minAllowedYear: minYearNumber ? Math.trunc(minYearNumber) : null,
      supportedModels,
      blockedModels: syncedBlocked,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Politica de veiculos atendidos
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Configure os modelos aceitos pela oficina e os bloqueios por modelo.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-red-200 bg-red-50 text-red-600"
          }`}
        >
          {message.text}
        </div>
      )}

      <datalist id="vehicle-model-catalog-suggestions">
        {BRAZIL_VEHICLE_CATALOG_MODELS.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <datalist id="vehicle-supported-suggestions">
        {sortedSupportedModels.map((model) => (
          <option key={model} value={prettifyModelLabel(model)} />
        ))}
      </datalist>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">Veiculos (tabela Brasil)</p>
            <p className="mt-1 text-xs text-slate-500">
              {sortedSupportedModels.length} modelo(s) cadastrado(s) para atendimento.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsCatalogModalOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Gerenciar veiculos
            </button>
            <button
              type="button"
              onClick={loadBrazilCatalogAsSupported}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              Carregar catalogo Brasil
            </button>
            <button
              type="button"
              onClick={clearSupportedModels}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Limpar
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            type="text"
            list="vehicle-model-catalog-suggestions"
            value={supportedModelInput}
            onChange={(e) => setSupportedModelInput(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Adicionar modelo (ex.: Onix)"
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

        <div className="mt-3">
          <input
            type="text"
            value={supportedSearch}
            onChange={(e) => setSupportedSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Pesquisar nos modelos cadastrados"
          />
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          {filteredSupportedModels.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nenhum modelo encontrado com esse filtro.
            </p>
          ) : (
            <div className="flex max-h-44 flex-wrap gap-2 overflow-auto pr-1">
              {filteredSupportedModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() =>
                    setSupportedModels((prev) => prev.filter((item) => item !== model))
                  }
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                  title="Remover modelo"
                >
                  {prettifyModelLabel(model)} x
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <label className="block text-sm font-medium text-slate-700">
          Ano minimo atendido (opcional)
          <input
            type="number"
            min={1980}
            max={2035}
            value={minAllowedYear}
            onChange={(e) => setMinAllowedYear(e.target.value)}
            className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Ex.: 2015"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Exemplo: 2015 bloqueia automaticamente veiculos abaixo de 2015.
          </span>
        </label>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <p className="text-sm font-semibold text-slate-800">Bloqueio por modelo</p>
        <p className="mt-1 text-xs text-slate-500">
          Somente modelos cadastrados em "Veiculos (tabela Brasil)" podem ser bloqueados.
        </p>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            type="text"
            list="vehicle-supported-suggestions"
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

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          {sortedBlockedModels.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum modelo bloqueado.</p>
          ) : (
            <div className="flex max-h-36 flex-wrap gap-2 overflow-auto pr-1">
              {sortedBlockedModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() =>
                    setBlockedModels((prev) => prev.filter((item) => item !== model))
                  }
                  className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700 hover:bg-rose-100"
                  title="Remover bloqueio"
                >
                  {prettifyModelLabel(model)} x
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar politica de veiculos"}
      </button>

      {isCatalogModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h4 className="text-base font-semibold text-slate-900">
                  Catalogo de veiculos do Brasil
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Selecione os modelos que sua oficina atende.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCatalogModalOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="Pesquisar no catalogo"
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowOnlySelectedInCatalog((current) => !current)
                  }
                  className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                    showOnlySelectedInCatalog
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {showOnlySelectedInCatalog ? "Mostrando selecionados" : "Mostrar so selecionados"}
                </button>
                <button
                  type="button"
                  onClick={loadBrazilCatalogAsSupported}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  Selecionar todos
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {supportedModels.length} selecionado(s) de {catalogModelsNormalized.length}
              </div>

              <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200">
                {catalogResults.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-500">
                    Nenhum modelo encontrado.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 divide-y divide-slate-100">
                    {catalogResults.map((item) => {
                      const selected = supportedSet.has(item.normalized);
                      return (
                        <button
                          key={item.normalized}
                          type="button"
                          onClick={() => toggleSupportedModel(item.normalized)}
                          className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${
                            selected
                              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span>{item.raw}</span>
                          <span className="text-xs font-semibold">
                            {selected ? "Selecionado" : "Adicionar"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

