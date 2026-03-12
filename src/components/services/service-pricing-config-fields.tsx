"use client";

import { useState } from "react";

interface ServicePricingConfigFieldsProps {
  priceDefaultValue?: string;
  requiresHumanDefaultChecked?: boolean;
  isActiveDefaultChecked?: boolean;
  compact?: boolean;
}

export function ServicePricingConfigFields({
  priceDefaultValue = "",
  requiresHumanDefaultChecked = false,
  isActiveDefaultChecked = true,
  compact = false,
}: ServicePricingConfigFieldsProps) {
  const [requiresHuman, setRequiresHuman] = useState(requiresHumanDefaultChecked);

  const inputClass = compact
    ? "w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-[var(--brand-muted)]"
    : "w-full rounded-xl border border-[var(--brand-muted)]/35 bg-white px-3 py-2.5 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-[var(--brand-muted)]";

  return (
    <>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--brand-muted)]">Preco</span>
        <input
          name="price"
          required={!requiresHuman}
          defaultValue={priceDefaultValue}
          disabled={requiresHuman}
          placeholder={requiresHuman ? "Orcamento tecnico (sem preco fixo)" : "Ex.: 120,00"}
          className={inputClass}
        />
      </label>

      <div className="space-y-2 rounded-xl border border-[var(--brand-muted)]/25 bg-white p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--brand-muted)]">
          Configuracoes
        </p>
        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
          <input type="checkbox" name="isActive" defaultChecked={isActiveDefaultChecked} />
          Ativo
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
          <input
            type="checkbox"
            name="requiresHuman"
            checked={requiresHuman}
            onChange={(event) => setRequiresHuman(event.target.checked)}
          />
          Precisa de atendimento humano
        </label>
      </div>
    </>
  );
}

