import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

type BulkDeletePayload = {
  ids?: string[];
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const org = await getCurrentOrganization();
  if (!org) {
    return NextResponse.json(
      { error: "Organizacao nao encontrada" },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as BulkDeletePayload | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "Nenhuma conversa selecionada" }, { status: 400 });
  }

  const deleted = await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.organizationId, org.id),
        inArray(conversations.id, ids)
      )
    )
    .returning({ id: conversations.id });

  return NextResponse.json({
    success: true,
    deletedCount: deleted.length,
    deletedIds: deleted.map((row) => row.id),
  });
}

