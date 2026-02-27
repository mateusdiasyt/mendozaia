"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";

function parseCurrencyToCents(raw: string): number {
  const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

function normalizeProductCategory(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const allowed = new Set(["oleo", "filtro", "peca", "acessorio", "outros"]);
  return allowed.has(value) ? value : "outros";
}

export async function listProducts() {
  const org = await getCurrentOrganization();
  if (!org) return { products: [] as Array<typeof products.$inferSelect> };

  const rows = await db
    .select()
    .from(products)
    .where(eq(products.organizationId, org.id));
  return { products: rows };
}

export async function createProduct(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const name = (formData.get("name") as string)?.trim();
  const model = ((formData.get("model") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim();
  const category = normalizeProductCategory((formData.get("category") as string) || "");
  const priceCents = parseCurrencyToCents((formData.get("price") as string) || "0");
  const stockQuantity = Number(formData.get("stockQuantity") || 0);
  const isActive = formData.get("isActive") === "on";

  if (!name) return { error: "Nome do produto é obrigatório" };
  if (priceCents <= 0) return { error: "Preço inválido" };

  await db.insert(products).values({
    organizationId: org.id,
    name,
    category,
    model: model || null,
    description: description || null,
    priceCents,
    stockQuantity: Number.isFinite(stockQuantity) ? Math.max(0, Math.floor(stockQuantity)) : 0,
    isActive,
  });

  revalidatePath("/dashboard/produtos");
  return { success: true };
}

export async function toggleProductActive(id: string, isActive: boolean) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  await db
    .update(products)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.organizationId, org.id)));

  revalidatePath("/dashboard/produtos");
  return { success: true };
}

export async function updateProductCategory(id: string, category: string) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const normalizedCategory = normalizeProductCategory(category) ?? "outros";

  await db
    .update(products)
    .set({ category: normalizedCategory, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.organizationId, org.id)));

  revalidatePath("/dashboard/produtos");
  revalidatePath("/dashboard/conversas");
  return { success: true };
}
