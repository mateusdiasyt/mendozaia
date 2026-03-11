"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { productCategories, products } from "@/lib/db/schema";
type Segment = "mecanica" | "restaurante" | "geral";
const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

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

async function parseOptionalImageDataUrl(
  raw: FormDataEntryValue | null
): Promise<{ hasFile: boolean; dataUrl: string | null; error: string | null }> {
  if (!(raw instanceof File) || raw.size <= 0) {
    return { hasFile: false, dataUrl: null, error: null };
  }

  if (raw.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    return { hasFile: true, dataUrl: null, error: "Imagem muito grande. Use ate 5MB." };
  }

  const mimeType = raw.type || "application/octet-stream";
  if (!mimeType.startsWith("image/")) {
    return { hasFile: true, dataUrl: null, error: "Formato invalido. Envie apenas imagem." };
  }

  const bytes = Buffer.from(await raw.arrayBuffer());
  const base64 = bytes.toString("base64");
  return {
    hasFile: true,
    dataUrl: `data:${mimeType};base64,${base64}`,
    error: null,
  };
}

async function ensureDefaultProductCategories(
  organizationId: string,
  segment: Segment
): Promise<void> {
  const existing = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(productCategories).values(defaultCategoryDefinitions(organizationId, segment));
}

function getOrganizationSegment(settings: unknown): Segment {
  const botConfig =
    (settings as Record<string, unknown> | undefined)?.botConfig as
      | Record<string, unknown>
      | undefined;
  const segment = botConfig?.segment;
  if (segment === "restaurante" || segment === "geral" || segment === "mecanica") {
    return segment;
  }
  return "mecanica";
}

function defaultCategoryDefinitions(organizationId: string, segment: Segment) {
  if (segment === "restaurante") {
    return [
      { organizationId, key: "entrada", name: "Entrada", aliases: "aperitivo,entrada,petisco" },
      {
        organizationId,
        key: "prato_principal",
        name: "Prato principal",
        aliases: "prato principal,almoco,jantar",
      },
      { organizationId, key: "bebida", name: "Bebida", aliases: "suco,refrigerante,drink" },
      { organizationId, key: "sobremesa", name: "Sobremesa", aliases: "doce,sobremesa" },
      { organizationId, key: "outros", name: "Outros", aliases: "diversos,geral" },
    ];
  }
  if (segment === "geral") {
    return [
      { organizationId, key: "principal", name: "Principal", aliases: "principal,produto" },
      { organizationId, key: "premium", name: "Premium", aliases: "premium,destaque" },
      { organizationId, key: "promocao", name: "Promoção", aliases: "promocao,oferta" },
      { organizationId, key: "outros", name: "Outros", aliases: "diversos,geral" },
    ];
  }
  return [
    { organizationId, key: "oleo", name: "Óleo", aliases: "lubrificante,5w30,10w40,0w20" },
    { organizationId, key: "filtro", name: "Filtro", aliases: "filtro de oleo,filtro de ar" },
    { organizationId, key: "peca", name: "Peça", aliases: "autopeca,reposicao" },
    { organizationId, key: "acessorio", name: "Acessório", aliases: "acessorio,extra" },
    { organizationId, key: "outros", name: "Outros", aliases: "diversos,geral" },
  ];
}

export async function listProducts() {
  const org = await getCurrentOrganization();
  if (!org) return { products: [] as Array<typeof products.$inferSelect> };
  const segment = getOrganizationSegment(org.settings);
  await ensureDefaultProductCategories(org.id, segment);

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
  const segment = getOrganizationSegment(org.settings);
  await ensureDefaultProductCategories(org.id, segment);

  const categories = await db
    .select()
    .from(productCategories)
    .where(eq(productCategories.organizationId, org.id));
  return { categories };
}

export async function createProduct(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };
  const segment = getOrganizationSegment(org.settings);
  await ensureDefaultProductCategories(org.id, segment);

  const name = (formData.get("name") as string)?.trim();
  const model = ((formData.get("model") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim();
  const category = normalizeProductCategory((formData.get("category") as string) || "");
  const priceCents = parseCurrencyToCents((formData.get("price") as string) || "0");
  const isInStock = parseInStock(formData.get("isInStock"));
  const isActive = formData.get("isActive") === "on";
  const imageResult = await parseOptionalImageDataUrl(formData.get("imageFile"));

  if (!name) return { error: "Nome do produto é obrigatório" };
  if (priceCents <= 0) return { error: "Preço inválido" };

  if (imageResult.error) return { error: imageResult.error };

  await db.insert(products).values({
    organizationId: org.id,
    name,
    category,
    model: model || null,
    description: description || null,
    imageUrl: imageResult.dataUrl,
    priceCents,
    isInStock,
    stockQuantity: isInStock ? 1 : 0,
    isActive,
  });

  revalidatePath("/dashboard/produtos");
  return { success: true };
}

export async function updateProductDetails(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Nao autorizado" };

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = normalizeProductCategory(String(formData.get("category") ?? "")) ?? "outros";
  const priceCents = parseCurrencyToCents(String(formData.get("price") ?? "0"));
  const isInStock = parseInStock(formData.get("isInStock"));
  const isActive = formData.get("isActive") === "on";
  const removeImage = formData.get("removeImage") === "on";
  const imageResult = await parseOptionalImageDataUrl(formData.get("imageFile"));

  if (!id) return { error: "Produto invalido" };
  if (!name) return { error: "Nome do produto obrigatorio" };
  if (priceCents <= 0) return { error: "Preco invalido" };
  if (imageResult.error) return { error: imageResult.error };

  const [existingCategory] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(
      and(eq(productCategories.organizationId, org.id), eq(productCategories.key, category))
    )
    .limit(1);
  if (!existingCategory) return { error: "Categoria nao encontrada" };

  const nextImageValue = removeImage
    ? null
    : imageResult.hasFile
      ? imageResult.dataUrl
      : undefined;

  await db
    .update(products)
    .set({
      name,
      model: model || null,
      description: description || null,
      category,
      priceCents,
      isInStock,
      stockQuantity: isInStock ? 1 : 0,
      isActive,
      ...(nextImageValue !== undefined ? { imageUrl: nextImageValue } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, id), eq(products.organizationId, org.id)));

  revalidatePath("/dashboard/produtos");
  revalidatePath("/dashboard/conversas");
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
