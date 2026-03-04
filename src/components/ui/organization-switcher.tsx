"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveOrganization } from "@/app/actions/organization";

type OrganizationOption = {
  id: string;
  name: string;
};

export function OrganizationSwitcher({
  organizations,
  activeOrganizationId,
}: {
  organizations: OrganizationOption[];
  activeOrganizationId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (organizations.length <= 1) {
    return null;
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
