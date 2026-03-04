"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitPaymentAndActivatePlan } from "@/app/actions/organization";
import { CheckCircle2, Lock, QrCode } from "lucide-react";

type PlanId = "starter" | "pro" | "scale";

const PIX_KEY = "113.673.289-69";
const PROOF_CONTACT = "45999287669";

const PLANS: Array<{
  id: PlanId;
  name: string;
  price: string;
  description: string;
  highlights: string[];
}> = [
  {
    id: "starter",
    name: "Starter",
    price: "R$ 299/mês",
    description: "Até 1.000 conversas/mês",
    highlights: ["1 número WhatsApp", "IA + automação + CRM", "Handoff humano técnico"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "R$ 599/mês",
    description: "Até 3.000 conversas/mês",
    highlights: ["1 número WhatsApp", "Fluxos avançados por segmento", "Suporte prioritário"],
  },
  {
    id: "scale",
    name: "Scale",
    price: "Sob consulta",
    description: "Operações com múltiplas unidades",
    highlights: ["1 número WhatsApp", "SLA e onboarding dedicado", "Personalização completa"],
  },
];

export function PlanPaywall({ organizationName }: { organizationName: string }) {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedPlanData = useMemo(
    () => PLANS.find((p) => p.id === selectedPlan) ?? null,
    [selectedPlan]
  );

  return (
    <div className="mx-auto w-full max-w-6xl p-8">
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6">
        <div className="flex items-center gap-3">
          <Lock className="h-5 w-5 text-indigo-700" />
          <h1 className="text-xl font-semibold text-indigo-900">
            Ative seu plano para liberar o menu completo
          </h1>
        </div>
        <p className="mt-2 text-sm text-indigo-800">
          A conta <strong>{organizationName}</strong> está sem plano ativo. Escolha um plano para
          liberar Conversas, WhatsApp, Reservas e Automações.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <article
            key={plan.id}
            className={`rounded-2xl border bg-white p-6 shadow-sm transition ${
              selectedPlan === plan.id ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"
            }`}
          >
            <h2 className="text-lg font-semibold text-slate-900">{plan.name}</h2>
            <p className="mt-1 text-3xl font-bold text-slate-900">{plan.price}</p>
            <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {plan.highlights.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              onClick={() => {
                setSuccessMessage(null);
                setSelectedPlan(plan.id);
              }}
            >
              Pagar este plano
            </button>
          </article>
        ))}
      </div>

      {selectedPlanData && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">
            Pagamento via PIX - Plano {selectedPlanData.name}
          </h3>
          <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">Chave PIX</p>
              <p className="mt-1 font-mono text-base">{PIX_KEY}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">Contato para comprovante</p>
              <p className="mt-1 font-mono text-base">{PROOF_CONTACT}</p>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Envie o comprovante para o contato acima e clique no botão abaixo. O painel será
              ativado automaticamente para o plano selecionado.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await submitPaymentAndActivatePlan(selectedPlanData.id);
                  if (!result?.error) {
                    setSuccessMessage("Comprovante enviado e plano ativado com sucesso.");
                    router.refresh();
                  }
                })
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Ativando..." : "Já enviei o comprovante"}
            </button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          <span>{successMessage}</span>
        </div>
      )}
    </div>
  );
}
