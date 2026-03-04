"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSetOrganizationPlan } from "@/app/actions/organization";

export function PlanActivationActions({
  organizationId,
  currentPlan,
}: {
  organizationId: string;
  currentPlan: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const plans: Array<"free" | "starter" | "pro" | "scale"> = [
    "free",
    "starter",
    "pro",
    "scale",
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {plans.map((plan) => (
        <button
          key={plan}
          type="button"
          disabled={pending || currentPlan === plan}
          onClick={() =>
            startTransition(async () => {
              const result = await adminSetOrganizationPlan(organizationId, plan);
              if (!result?.error) {
                router.refresh();
              }
            })
          }
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
            currentPlan === plan
              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {plan.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
