"use server";

import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { nanoid } from "nanoid";

export async function createWhatsAppSession(
  organizationId: string,
  name: string
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Não autorizado");

  const org = await getCurrentOrganization();
  if (!org || org.id !== organizationId) throw new Error("Organização inválida");

  const sessionId = `mendoza-${nanoid(12)}`;

  await db.insert(whatsappSessions).values({
    organizationId,
    sessionId,
    name: name || "Sessão 1",
    status: "disconnected",
  });

  return { sessionId };
}
