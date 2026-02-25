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
          ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
          : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
      } disabled:opacity-50`}
    >
      {pending ? "..." : isActive ? "Desativar" : "Ativar"}
    </button>
  );
}
