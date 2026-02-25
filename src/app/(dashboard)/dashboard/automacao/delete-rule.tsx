"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAutomationRule } from "@/app/actions/automation";
import { Trash2 } from "lucide-react";

export function DeleteRuleButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm("Excluir esta regra?")) return;
    startTransition(async () => {
      await deleteAutomationRule(id);
      router.refresh();
    });
  };

  return (
    <button
      onClick={handleDelete}
      disabled={pending}
      className="rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
      title="Excluir"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
