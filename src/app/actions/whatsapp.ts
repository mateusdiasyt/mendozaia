"use server";

import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { createInstance, connectInstance } from "@/lib/evolution-api";

export async function createWhatsAppSession(
  organizationId: string,
  name: string
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autorizado");

  const org = await getCurrentOrganization();
  if (!org || org.id !== organizationId) throw new Error("Organização inválida");

  const sessionId = `mendoza-${nanoid(12)}`;

  const webhookUrl = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/api/webhooks/whatsapp`
    : undefined;

  try {
    await createInstance(sessionId, webhookUrl);
  } catch (err) {
    console.error("[createWhatsAppSession] Evolution API:", err);
    throw new Error(
      err instanceof Error ? err.message : "Falha ao criar instância na Evolution API"
    );
  }

  await db.insert(whatsappSessions).values({
    organizationId,
    sessionId,
    name: name || "Sessão 1",
    status: "connecting",
  });

  return { sessionId };
}

export async function getQRCode(sessionId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autorizado");

  const org = await getCurrentOrganization();
  if (!org) throw new Error("Organização não encontrada");

  const [wsSession] = await db
    .select()
    .from(whatsappSessions)
    .where(
      and(
        eq(whatsappSessions.sessionId, sessionId),
        eq(whatsappSessions.organizationId, org.id)
      )
    )
    .limit(1);

  if (!wsSession) throw new Error("Sessão não encontrada");

  const data = await connectInstance(sessionId);
  return { code: data.code ?? data.pairingCode ?? null };
}
