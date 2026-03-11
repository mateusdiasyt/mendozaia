"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { organizations, whatsappSessions } from "@/lib/db/schema";
import { and, eq, like } from "drizzle-orm";
import { parseMetaChannelsSettings } from "@/lib/meta-channel-settings";

export async function setActiveMetaPage(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Nao autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("Organizacao nao encontrada");

  const pageId = String(formData.get("pageId") ?? "").trim();
  if (!pageId) throw new Error("pageId obrigatorio");

  const currentSettings = (org.settings as Record<string, unknown> | undefined) ?? {};
  const metaSettings = parseMetaChannelsSettings(currentSettings.metaChannels);
  if (!metaSettings.channels.some((channel) => channel.pageId === pageId)) {
    throw new Error("Canal nao encontrado");
  }

  await db
    .update(organizations)
    .set({
      settings: {
        ...currentSettings,
        metaChannels: {
          ...metaSettings,
          activePageId: pageId,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  revalidatePath("/dashboard/whatsapp");
}

export async function disconnectMetaChannels() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Nao autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("Organizacao nao encontrada");

  const currentSettings = (org.settings as Record<string, unknown> | undefined) ?? {};
  const nextSettings = { ...currentSettings };
  delete nextSettings.metaChannels;

  await db
    .update(organizations)
    .set({
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  await db
    .update(whatsappSessions)
    .set({
      status: "disconnected",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappSessions.organizationId, org.id),
        like(whatsappSessions.sessionId, "meta-%")
      )
    );

  revalidatePath("/dashboard/whatsapp");
}

