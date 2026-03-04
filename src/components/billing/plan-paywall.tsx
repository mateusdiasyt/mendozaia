"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitPaymentProof } from "@/app/actions/organization";
import { CheckCircle2, Lock, QrCode, AlertCircle } from "lucide-react";

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

export function PlanPaywall({
  organizationName,
  billingStatus,
  requestedPlan,
  proofFileNameInitial,
}: {
  organizationName: string;
  billingStatus?: string | null;
  requestedPlan?: string | null;
  proofFileNameInitial?: string | null;
}) {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [step, setStep] = useState<"select" | "proof">("select");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedPlanData = useMemo(
    () => PLANS.find((p) => p.id === selectedPlan) ?? null,
    [selectedPlan]
  );
  const isAwaitingApproval = billingStatus === "pending_approval";
  const currentStep = isAwaitingApproval ? 3 : step === "proof" ? 3 : selectedPlanData ? 2 : 1;

  return (
    <div className="mx-auto w-full max-w-6xl p-8">
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6">
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

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-2 md:grid-cols-3">
          <StepItem
            index={1}
            title="Escolha do plano"
            active={currentStep >= 1}
            done={currentStep > 1}
          />
          <StepItem
            index={2}
            title="Pagamento via PIX"
            active={currentStep >= 2}
            done={currentStep > 2}
          />
          <StepItem
            index={3}
            title="Envio de comprovante"
            active={currentStep >= 3}
            done={isAwaitingApproval}
          />
        </div>
      </div>

      {billingStatus === "pending_approval" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
          <p className="font-semibold">Aguardando aprovação, aguarde um momento.</p>
          <p className="mt-1">
            {requestedPlan ? `Plano solicitado: ${requestedPlan.toUpperCase()}. ` : ""}
            {proofFileNameInitial ? `Comprovante recebido: ${proofFileNameInitial}.` : ""}
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <article
            key={plan.id}
            className={`rounded-2xl border bg-white p-6 shadow-sm transition ${
              selectedPlan === plan.id ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200"
            }`}
          >
            <h2 className="text-lg font-semibold text-slate-900">
              {plan.name}
              {selectedPlan === plan.id && (
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  Selecionado
                </span>
              )}
            </h2>
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
                setErrorMessage(null);
                setStep("select");
                setSelectedPlan(plan.id);
              }}
            >
              Escolher plano
            </button>
          </article>
        ))}
      </div>

      {selectedPlanData && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                Checkout do plano
              </p>
              <h3 className="mt-1 text-lg font-semibold text-indigo-900">
                {selectedPlanData.name} - {selectedPlanData.price}
              </h3>
            </div>

            <h4 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-600">
              Etapa 2 - Pague com PIX
            </h4>
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
                Envie o valor do plano para a chave PIX acima e depois avance para enviar o comprovante.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {step === "select" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setStep("proof");
                    setSuccessMessage(null);
                    setErrorMessage(null);
                    setProofFile(null);
                  }}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Já enviei o pagamento
                </button>
              ) : (
                <div className="w-full space-y-3">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                    Etapa 3 - Envie o comprovante
                  </h4>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    Envie o arquivo do comprovante (print ou PDF) para análise do admin.
                  </div>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(event) => setProofFile(event.target.files?.[0] ?? null)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
                  />
                  {proofFile && (
                    <p className="text-xs text-slate-500">Arquivo selecionado: {proofFile.name}</p>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setErrorMessage(null);
                        if (!proofFile) {
                          setErrorMessage("Selecione o arquivo do comprovante.");
                          return;
                        }
                        const formData = new FormData();
                        formData.set("plan", selectedPlanData.id);
                        formData.set("proofFile", proofFile);
                        const result = await submitPaymentProof(formData);
                        if (result?.error) {
                          setErrorMessage(result.error);
                          return;
                        }
                        setSuccessMessage(
                          "Comprovante enviado. Aguardando aprovação, aguarde um momento."
                        );
                        router.refresh();
                      })
                    }
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? "Enviando..." : "Enviar comprovante no painel"}
                  </button>
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6 lg:h-fit">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Resumo do pedido
            </h4>
            <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-800">Plano</p>
              <p className="text-slate-700">{selectedPlanData.name}</p>
              <p className="font-medium text-slate-800">Valor</p>
              <p className="text-lg font-semibold text-slate-900">{selectedPlanData.price}</p>
              <p className="font-medium text-slate-800">Cobrança</p>
              <p className="text-slate-700">Mensal</p>
            </div>

            <h5 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Checklist de envio
            </h5>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 ${selectedPlanData ? "text-emerald-600" : "text-slate-300"}`} />
                Plano selecionado
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 ${step === "proof" || isAwaitingApproval ? "text-emerald-600" : "text-slate-300"}`} />
                Pagamento realizado
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 ${proofFile || isAwaitingApproval ? "text-emerald-600" : "text-slate-300"}`} />
                Comprovante enviado
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 ${isAwaitingApproval ? "text-amber-600" : "text-slate-300"}`} />
                Aguardando aprovação do admin
              </li>
            </ul>
          </aside>
        </div>
      )}

      {successMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          <span>{successMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

function StepItem({
  index,
  title,
  active,
  done,
}: {
  index: number;
  title: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 text-sm ${
        active ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-emerald-100 text-emerald-700"
              : active
                ? "bg-indigo-100 text-indigo-700"
                : "bg-slate-200 text-slate-600"
          }`}
        >
          {index}
        </span>
        <span className="font-medium text-slate-800">{title}</span>
      </div>
    </div>
  );
}
