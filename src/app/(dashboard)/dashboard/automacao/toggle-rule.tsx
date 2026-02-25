"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleAutomationRule } from "@/app/actions/automation";

export function ToggleRuleButton({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        startTransition(() => {
          void toggleAutomationRule(id, !isActive).then(() =>
            router.refresh()
          );
        });
      }}
      disabled={pending}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        isActive
          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      } disabled:opacity-50`}
    >
      {pending ? "..." : isActive ? "Desativar" : "Ativar"}
    </button>
  );
}
