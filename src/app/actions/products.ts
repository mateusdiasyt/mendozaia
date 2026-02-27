"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { productCategories, products } from "@/lib/db/schema";

function parseCurrencyToCents(raw: string): number {
  const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

function normalizeProductCategory(raw: string): string | null {
  const value = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!value) return null;
  return value.slice(0, 50);
}

function parseInStock(raw: FormDataEntryValue | null): boolean {
  return String(raw ?? "yes") === "yes";
}

async function ensureDefaultProductCategories(organizationId: string): Promise<void> {
  const existing = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(productCategories).values([
    { organizationId, key: "oleo", name: "Óleo", aliases: "lubrificante,5w30,10w40,0w20" },
    { organizationId, key: "filtro", name: "Filtro", aliases: "filtro de oleo,filtro de ar" },
    { organizationId, key: "peca", name: "Peça", aliases: "autopeça,reposição" },
    { organizationId, key: "acessorio", name: "Acessório", aliases: "acessório,extra" },
    { organizationId, key: "outros", name: "Outros", aliases: "diversos,geral" },
  ]);
}

export async function listProducts() {
  const org = await getCurrentOrganization();
  if (!org) return { products: [] as Array<typeof products.$inferSelect> };
  await ensureDefaultProductCategories(org.id);

  const rows = await db
    .select()
    .from(products)
    .where(eq(products.organizationId, org.id));
  return { products: rows };
}

export async function listProductCategories() {
  const org = await getCurrentOrganization();
  if (!org) {
    return { categories: [] as Array<typeof productCategories.$inferSelect> };
  }
  await ensureDefaultProductCategories(org.id);

  const categories = await db
    .select()
    .from(productCategories)
    .where(eq(productCategories.organizationId, org.id));
  return { categories };
}

export async function createProduct(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const name = (formData.get("name") as string)?.trim();
  const model = ((formData.get("model") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim();
  const category = normalizeProductCategory((formData.get("category") as string) || "");
  const priceCents = parseCurrencyToCents((formData.get("price") as string) || "0");
  const isInStock = parseInStock(formData.get("isInStock"));
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
    isInStock,
    stockQuantity: isInStock ? 1 : 0,
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
  const [existingCategory] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(
      and(
        eq(productCategories.organizationId, org.id),
        eq(productCategories.key, normalizedCategory)
      )
    )
    .limit(1);
  if (!existingCategory) return { error: "Categoria não encontrada" };

  await db
    .update(products)
    .set({ category: normalizedCategory, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.organizationId, org.id)));

  revalidatePath("/dashboard/produtos");
  revalidatePath("/dashboard/conversas");
  return { success: true };
}

export async function updateProductStockStatus(id: string, isInStock: boolean) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  await db
    .update(products)
    .set({
      isInStock,
      stockQuantity: isInStock ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, id), eq(products.organizationId, org.id)));

  revalidatePath("/dashboard/produtos");
  return { success: true };
}

export async function createProductCategory(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const name = String(formData.get("name") ?? "").trim();
  const aliases = String(formData.get("aliases") ?? "").trim();
  if (!name) return { error: "Nome da categoria é obrigatório" };

  const key = normalizeProductCategory(name);
  if (!key) return { error: "Categoria inválida" };

  const [existing] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(
      and(
        eq(productCategories.organizationId, org.id),
        eq(productCategories.key, key)
      )
    )
    .limit(1);
  if (existing) return { error: "Essa categoria já existe" };

  await db.insert(productCategories).values({
    organizationId: org.id,
    key,
    name,
    aliases: aliases || null,
  });

  revalidatePath("/dashboard/produtos");
  return { success: true };
}

export async function updateProductCategoryDefinition(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const aliases = String(formData.get("aliases") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "") === "on";
  if (!id || !name) return { error: "Dados inválidos" };

  await db
    .update(productCategories)
    .set({
      name,
      aliases: aliases || null,
      isActive,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productCategories.id, id),
        eq(productCategories.organizationId, org.id)
      )
    );

  revalidatePath("/dashboard/produtos");
  revalidatePath("/dashboard/conversas");
  return { success: true };
}
