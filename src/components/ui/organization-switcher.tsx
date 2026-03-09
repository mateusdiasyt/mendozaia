"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveOrganization } from "@/app/actions/organization";
import { Building2 } from "lucide-react";

type OrganizationOption = {
  id: string;
  name: string;
};

export function OrganizationSwitcher({
  organizations,
  activeOrganizationId,
  compact = false,
}: {
  organizations: OrganizationOption[];
  activeOrganizationId: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (organizations.length <= 1) {
    return null;
  }

  if (compact) {
    return (
      <div className="group relative">
        <button
          type="button"
          aria-label="Trocar organizacao"
          className="flex items-center justify-center rounded-xl p-3 text-[var(--brand-muted)] transition-colors hover:bg-white hover:text-[var(--brand-deep)]"
        >
          <Building2 className="h-5 w-5" />
        </button>
        <div className="pointer-events-none absolute left-full top-1/2 z-30 ml-3 w-56 -translate-y-1/2 rounded-xl border border-[var(--brand-muted)]/25 bg-white p-3 opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <label
            htmlFor="org-switcher-compact"
            className="mb-1 block text-[11px] font-medium text-[var(--brand-muted)]"
          >
            Organizacao ativa
          </label>
          <select
            id="org-switcher-compact"
            className="w-full rounded-lg border border-[var(--brand-muted)]/30 bg-white px-2 py-2 text-xs text-[var(--brand-deep)] outline-none transition focus:border-[var(--brand-primary)]"
            value={activeOrganizationId ?? organizations[0]?.id ?? ""}
            disabled={pending}
            onChange={(event) => {
              const nextOrgId = event.target.value;
              startTransition(async () => {
                const result = await setActiveOrganization(nextOrgId);
                if (!result?.error) {
                  router.refresh();
                  router.push("/dashboard");
                }
              });
            }}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 px-1">
      <label htmlFor="org-switcher" className="mb-1 block text-[11px] font-medium text-slate-500">
        Organização ativa
      </label>
      <select
        id="org-switcher"
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 outline-none transition focus:border-indigo-300"
        value={activeOrganizationId ?? organizations[0]?.id ?? ""}
        disabled={pending}
        onChange={(event) => {
          const nextOrgId = event.target.value;
          startTransition(async () => {
            const result = await setActiveOrganization(nextOrgId);
            if (!result?.error) {
              router.refresh();
              router.push("/dashboard");
            }
          });
        }}
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </div>
  );
}
