/**
 * Sincroniza o status da sessão com a Evolution API.
 * Útil quando o webhook CONNECTION_UPDATE não chegou ou o status ficou dessincronizado.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchInstanceStatus, setInstanceWebhook } from "@/lib/evolution-api";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const org = await getCurrentOrganization();
    if (!org) {
      return NextResponse.json(
        { error: "Organização não encontrada" },
        { status: 404 }
      );
    }

    const { sessionId } = await params;

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

    if (!wsSession) {
      return NextResponse.json(
        { error: "Sessão não encontrada" },
        { status: 404 }
      );
    }

    const webhookUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/api/webhooks/whatsapp`
      : null;
    if (webhookUrl) {
      await setInstanceWebhook(sessionId, webhookUrl);
    }

    const state = await fetchInstanceStatus(sessionId);
    const status =
      state === "open" || state === "connected" ? "connected" : "disconnected";

    await db
      .update(whatsappSessions)
      .set({
        status,
        lastConnectedAt: status === "connected" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(whatsappSessions.id, wsSession.id));

    return NextResponse.json({ status });
  } catch (err) {
    console.error("[sync-status]", err);
    return NextResponse.json(
      { error: "Erro ao sincronizar status" },
      { status: 500 }
    );
  }
}
