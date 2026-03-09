import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { connectInstance } from "@/lib/evolution-api";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
    }

    const org = await getCurrentOrganization();
    if (!org) {
      return NextResponse.json({ error: "Organizacao nao encontrada" }, { status: 404 });
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
      return NextResponse.json({ error: "Sessao nao encontrada" }, { status: 404 });
    }

    await connectInstance(sessionId);

    await db
      .update(whatsappSessions)
      .set({
        status: "connecting",
        updatedAt: new Date(),
      })
      .where(eq(whatsappSessions.id, wsSession.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reconnect-session]", err);
    return NextResponse.json({ error: "Erro ao reconectar sessao" }, { status: 500 });
  }
}

