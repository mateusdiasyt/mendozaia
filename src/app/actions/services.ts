"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";

function parseCurrencyToCents(raw: string): number {
  const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export async function listServices() {
  const org = await getCurrentOrganization();
  if (!org) return { services: [] as Array<typeof services.$inferSelect> };

  const rows = await db
    .select()
    .from(services)
    .where(eq(services.organizationId, org.id));
  return { services: rows };
}

export async function createService(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const name = (formData.get("name") as string)?.trim();
  const description = ((formData.get("description") as string) || "").trim();
  const priceCents = parseCurrencyToCents((formData.get("price") as string) || "0");
  const durationMinutes = Number(formData.get("durationMinutes") || 60);
  const isActive = formData.get("isActive") === "on";

  if (!name) return { error: "Nome do serviço é obrigatório" };
  if (priceCents <= 0) return { error: "Preço inválido" };

  await db.insert(services).values({
    organizationId: org.id,
    name,
    description: description || null,
    priceCents,
    durationMinutes: Number.isFinite(durationMinutes)
      ? Math.max(1, Math.floor(durationMinutes))
      : 60,
    isActive,
  });

  revalidatePath("/dashboard/servicos");
  return { success: true };
}

export async function toggleServiceActive(id: string, isActive: boolean) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  await db
    .update(services)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(services.id, id), eq(services.organizationId, org.id)));

  revalidatePath("/dashboard/servicos");
  return { success: true };
}
