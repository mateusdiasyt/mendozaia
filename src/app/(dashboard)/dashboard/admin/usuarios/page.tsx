import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { getCurrentMembership } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { PlanActivationActions } from "./plan-activation-actions";

function planLabel(plan: string): string {
  if (plan === "free" || plan === "none") return "Sem plano";
  if (plan === "starter") return "Starter";
  if (plan === "pro") return "Pro";
  if (plan === "scale") return "Scale";
  return plan;
}

export default async function AdminUsuariosPage() {
  const membership = await getCurrentMembership();
  if (!membership || membership.role !== "platform_admin") {
    notFound();
  }

  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      plan: organizations.plan,
      status: organizations.status,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt));

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Usuários e Planos</h1>
        <p className="mt-1 text-slate-500">
          Ative planos manualmente por organização.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Organização</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Plano atual</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Ativar plano</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orgs.map((org) => (
              <tr key={org.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{org.name}</p>
                  <p className="text-xs text-slate-500">{org.id}</p>
                </td>
                <td className="px-4 py-3 text-slate-700">{planLabel(org.plan)}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                    {org.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <PlanActivationActions organizationId={org.id} currentPlan={org.plan} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
