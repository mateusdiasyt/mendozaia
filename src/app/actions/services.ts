"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { organizations, services } from "@/lib/db/schema";

function parseCurrencyToCents(raw: string): number {
  const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

function normalizeServiceLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePriorityValue(raw: FormDataEntryValue | null | undefined, fallback = 3): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(9, Math.max(1, Math.floor(value)));
}

function parseServiceHumanPolicy(
  settings: Record<string, unknown> | null | undefined
): {
  byServiceId: Record<string, boolean>;
  byName: Record<string, boolean>;
} {
  const root = (settings ?? {}) as Record<string, unknown>;
  const policy =
    (root.serviceHumanPolicy as Record<string, unknown> | undefined) ?? {};
  const rawById = (policy.byServiceId as Record<string, unknown> | undefined) ?? {};
  const rawByName = (policy.byName as Record<string, unknown> | undefined) ?? {};

  const byServiceId: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rawById)) {
    if (typeof value === "boolean" && key.trim().length > 0) {
      byServiceId[key] = value;
    }
  }

  const byName: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rawByName)) {
    if (typeof value === "boolean") {
      const normalized = normalizeServiceLabel(key);
      if (normalized) byName[normalized] = value;
    }
  }

  return { byServiceId, byName };
}

function parseServicePriorityPolicy(
  settings: Record<string, unknown> | null | undefined
): {
  byServiceId: Record<string, number>;
  byName: Record<string, number>;
} {
  const root = (settings ?? {}) as Record<string, unknown>;
  const policy =
    (root.servicePriorityPolicy as Record<string, unknown> | undefined) ?? {};
  const rawById = (policy.byServiceId as Record<string, unknown> | undefined) ?? {};
  const rawByName = (policy.byName as Record<string, unknown> | undefined) ?? {};

  const parsePriority = (value: unknown): number | null => {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.min(9, Math.max(1, Math.floor(num)));
  };

  const byServiceId: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawById)) {
    const parsed = parsePriority(value);
    if (parsed && key.trim().length > 0) {
      byServiceId[key] = parsed;
    }
  }

  const byName: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawByName)) {
    const normalized = normalizeServiceLabel(key);
    const parsed = parsePriority(value);
    if (normalized && parsed) {
      byName[normalized] = parsed;
    }
  }

  return { byServiceId, byName };
}

async function persistServicePolicies(
  organizationId: string,
  payload: {
    humanByServiceId: Record<string, boolean>;
    humanByName: Record<string, boolean>;
    priorityByServiceId: Record<string, number>;
    priorityByName: Record<string, number>;
  }
) {
  const [orgRow] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const currentSettings =
    (orgRow?.settings as Record<string, unknown> | undefined) ?? {};

  await db
    .update(organizations)
    .set({
      settings: {
        ...currentSettings,
        serviceHumanPolicy: {
          byServiceId: payload.humanByServiceId,
          byName: payload.humanByName,
        },
        servicePriorityPolicy: {
          byServiceId: payload.priorityByServiceId,
          byName: payload.priorityByName,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}

export async function listServices() {
  const org = await getCurrentOrganization();
  if (!org) {
    return {
      services: [] as Array<
        typeof services.$inferSelect & { requiresHuman: boolean; priority: number }
      >,
    };
  }

  const rows = await db
    .select()
    .from(services)
    .where(eq(services.organizationId, org.id));

  const { byServiceId, byName } = parseServiceHumanPolicy(
    (org.settings as Record<string, unknown> | undefined) ?? {}
  );
  const { byServiceId: priorityByServiceId, byName: priorityByName } =
    parseServicePriorityPolicy((org.settings as Record<string, unknown> | undefined) ?? {});

  return {
    services: rows.map((item) => {
      const normalizedName = normalizeServiceLabel(item.name);
      const requiresHuman =
        byServiceId[item.id] ??
        (normalizedName ? byName[normalizedName] : false) ??
        false;
      const priority =
        priorityByServiceId[item.id] ??
        (normalizedName ? priorityByName[normalizedName] : undefined) ??
        3;
      return { ...item, requiresHuman, priority };
    }),
  };
}

export async function createService(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "Não autorizado" };

  const name = (formData.get("name") as string)?.trim();
  const description = ((formData.get("description") as string) || "").trim();
  const priceCents = parseCurrencyToCents((formData.get("price") as string) || "0");
  const durationMinutes = Number(formData.get("durationMinutes") || 60);
  const priority = parsePriorityValue(formData.get("priority"), 3);
  const isActive = formData.get("isActive") === "on";
  const requiresHuman = formData.get("requiresHuman") === "on";

  if (!name) return { error: "Nome do serviço é obrigatório" };
  if (priceCents <= 0) return { error: "Preço inválido" };

  const [created] = await db
    .insert(services)
    .values({
    organizationId: org.id,
    name,
    description: description || null,
    priceCents,
    durationMinutes: Number.isFinite(durationMinutes)
      ? Math.max(1, Math.floor(durationMinutes))
      : 60,
    isActive,
    })
    .returning({ id: services.id, name: services.name });

  if (created) {
    const { byServiceId, byName } = parseServiceHumanPolicy(
      (org.settings as Record<string, unknown> | undefined) ?? {}
    );
    const { byServiceId: priorityByServiceId, byName: priorityByName } =
      parseServicePriorityPolicy((org.settings as Record<string, unknown> | undefined) ?? {});
    const normalizedName = normalizeServiceLabel(created.name);
    byServiceId[created.id] = requiresHuman;
    if (normalizedName) byName[normalizedName] = requiresHuman;
    priorityByServiceId[created.id] = priority;
    if (normalizedName) priorityByName[normalizedName] = priority;
    await persistServicePolicies(org.id, {
      humanByServiceId: byServiceId,
      humanByName: byName,
      priorityByServiceId,
      priorityByName,
    });
  }

  revalidatePath("/dashboard/servicos");
  return { success: true };
}

export async function updateService(formData: FormData) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "NÃ£o autorizado" };

  const id = (formData.get("id") as string)?.trim();
  const name = (formData.get("name") as string)?.trim();
  const description = ((formData.get("description") as string) || "").trim();
  const priceCents = parseCurrencyToCents((formData.get("price") as string) || "0");
  const durationMinutes = Number(formData.get("durationMinutes") || 60);
  const priority = parsePriorityValue(formData.get("priority"), 3);
  const isActive = formData.get("isActive") === "on";
  const requiresHuman = formData.get("requiresHuman") === "on";

  if (!id) return { error: "ServiÃ§o invÃ¡lido" };
  if (!name) return { error: "Nome do serviÃ§o Ã© obrigatÃ³rio" };
  if (priceCents <= 0) return { error: "PreÃ§o invÃ¡lido" };

  const [currentService] = await db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.id, id), eq(services.organizationId, org.id)))
    .limit(1);

  if (!currentService) return { error: "ServiÃ§o nÃ£o encontrado" };

  await db
    .update(services)
    .set({
      name,
      description: description || null,
      priceCents,
      durationMinutes: Number.isFinite(durationMinutes)
        ? Math.max(1, Math.floor(durationMinutes))
        : 60,
      isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(services.id, id), eq(services.organizationId, org.id)));

  const { byServiceId, byName } = parseServiceHumanPolicy(
    (org.settings as Record<string, unknown> | undefined) ?? {}
  );
  const { byServiceId: priorityByServiceId, byName: priorityByName } =
    parseServicePriorityPolicy((org.settings as Record<string, unknown> | undefined) ?? {});

  const previousNameKey = normalizeServiceLabel(currentService.name);
  if (previousNameKey) {
    delete byName[previousNameKey];
    delete priorityByName[previousNameKey];
  }

  const nextNameKey = normalizeServiceLabel(name);
  byServiceId[id] = requiresHuman;
  if (nextNameKey) {
    byName[nextNameKey] = requiresHuman;
    priorityByName[nextNameKey] = priority;
  }
  priorityByServiceId[id] = priority;

  await persistServicePolicies(org.id, {
    humanByServiceId: byServiceId,
    humanByName: byName,
    priorityByServiceId,
    priorityByName,
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

export async function setServiceRequiresHuman(id: string, requiresHuman: boolean) {
  const org = await getCurrentOrganization();
  if (!org) return { error: "NÃ£o autorizado" };

  const [serviceRow] = await db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.id, id), eq(services.organizationId, org.id)))
    .limit(1);

  if (!serviceRow) return { error: "ServiÃ§o nÃ£o encontrado" };

  const { byServiceId, byName } = parseServiceHumanPolicy(
    (org.settings as Record<string, unknown> | undefined) ?? {}
  );
  const { byServiceId: priorityByServiceId, byName: priorityByName } =
    parseServicePriorityPolicy((org.settings as Record<string, unknown> | undefined) ?? {});
  byServiceId[serviceRow.id] = requiresHuman;
  const normalizedName = normalizeServiceLabel(serviceRow.name);
  if (normalizedName) byName[normalizedName] = requiresHuman;

  await persistServicePolicies(org.id, {
    humanByServiceId: byServiceId,
    humanByName: byName,
    priorityByServiceId,
    priorityByName,
  });

  revalidatePath("/dashboard/servicos");
  return { success: true };
}
