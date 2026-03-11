import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

async function upsertMetaSession(params: {
  organizationId: string;
  sessionId: string;
  name: string;
}) {
  const [existing] = await db
    .select({ id: whatsappSessions.id })
    .from(whatsappSessions)
    .where(
      and(
        eq(whatsappSessions.organizationId, params.organizationId),
        eq(whatsappSessions.sessionId, params.sessionId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(whatsappSessions)
      .set({
        name: params.name,
        status: "connected",
        lastConnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whatsappSessions.id, existing.id));
    return;
  }

  await db.insert(whatsappSessions).values({
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    name: params.name,
    status: "connected",
    lastConnectedAt: new Date(),
  });
}

export async function ensureMetaSessionsForPage(params: {
  organizationId: string;
  pageId: string;
  pageName: string;
  instagramBusinessAccountId?: string | null;
  instagramUsername?: string | null;
}) {
  await upsertMetaSession({
    organizationId: params.organizationId,
    sessionId: `meta-page-${params.pageId}`,
    name: `Messenger - ${params.pageName}`,
  });

  const igId = params.instagramBusinessAccountId?.trim() ?? "";
  if (igId) {
    await upsertMetaSession({
      organizationId: params.organizationId,
      sessionId: `meta-ig-${igId}`,
      name: `Instagram - ${params.instagramUsername || params.pageName}`,
    });
  }
}

