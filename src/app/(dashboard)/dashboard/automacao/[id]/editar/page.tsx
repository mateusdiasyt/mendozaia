import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { automationRules, tags } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RuleForm } from "../../rule-form";
import { notFound } from "next/navigation";

export default async function EditarRegraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getCurrentOrganization();
  if (!org) return null;

  const [rule] = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.id, id),
        eq(automationRules.organizationId, org.id)
      )
    )
    .limit(1);

  if (!rule) notFound();

  const orgTags = await db
    .select()
    .from(tags)
    .where(eq(tags.organizationId, org.id));

  return (
    <div className="p-8">
      <Link
        href="/dashboard/automacao"
        className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-white">Editar regra</h1>
        <p className="mt-1 text-zinc-400">{rule.name}</p>

        <RuleForm
          organizationId={org.id}
          tags={orgTags}
          rule={rule}
        />
      </div>
    </div>
  );
}
