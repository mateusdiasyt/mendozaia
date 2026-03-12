import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function POST(
  request: NextRequest,
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
    const body = await request.json().catch(() => ({}));
    const rawName = typeof body?.name === "string" ? body.name : "";
    const name = rawName.trim();

    if (!name) {
      return NextResponse.json({ error: "Nome invalido" }, { status: 400 });
    }

    const [wsSession] = await db
      .select({ id: whatsappSessions.id })
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

    await db
      .update(whatsappSessions)
      .set({
        name,
        updatedAt: new Date(),
      })
      .where(eq(whatsappSessions.id, wsSession.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[update-session-name]", err);
    return NextResponse.json({ error: "Erro ao atualizar nome" }, { status: 500 });
  }
}
