"use client";

import { useState } from "react";
import { updateBusinessProfileConfig } from "@/app/actions/organization";

interface BusinessProfileFormProps {
  initialConfig: {
    botName: string;
    instagram: string;
    address: string;
    mapsLink: string;
  };
}

export function BusinessProfileForm({ initialConfig }: BusinessProfileFormProps) {
  const [botName, setBotName] = useState(initialConfig.botName);
  const [instagram, setInstagram] = useState(initialConfig.instagram);
  const [address, setAddress] = useState(initialConfig.address);
  const [mapsLink, setMapsLink] = useState(initialConfig.mapsLink);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const result = await updateBusinessProfileConfig({
      botName,
      instagram,
      address,
      mapsLink,
    });

    setSaving(false);
    if (result?.error) {
      setMessage({ type: "error", text: result.error });
      return;
    }
    setMessage({
      type: "success",
      text: "Dados da empresa salvos com sucesso.",
    });
  }

  const inputClass =
    "mt-2 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Dados da empresa</h3>
        <p className="mt-1 text-sm text-slate-500">
          O bot usa estes dados para responder perguntas de contato e localização.
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
        Nome do bot
        <input
          type="text"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          className={inputClass}
          placeholder="Alan"
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Instagram
        <input
          type="text"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
          className={inputClass}
          placeholder="@suaoficina"
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Endereço
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Rua Exemplo, 123 - Bairro - Cidade/UF"
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Link do Google Maps
        <input
          type="url"
          value={mapsLink}
          onChange={(e) => setMapsLink(e.target.value)}
          className={inputClass}
          placeholder="https://maps.google.com/..."
        />
      </label>

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-60"
      >
        {saving ? "Salvando..." : "Salvar dados da empresa"}
      </button>
    </form>
  );
}
