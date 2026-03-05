/**
 * Feedback humano sobre a última resposta (IA ou FAQ).
 * POST body: { type: "good" | "bad" }
 * Ajusta qualityScore dos exemplos ou confidenceScore da FAQ.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getLastUsedExampleIds,
  clearLastUsedExampleIds,
  updateQualityScore,
} from "@/lib/ai-training";
import {
  getLastUsedFaqId,
  clearLastUsedFaqId,
  updateFaqConfidence,
} from "@/lib/faq-engine";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const org = await getCurrentOrganization();
  if (!org) {
    return NextResponse.json({ error: "Organização não encontrada" }, { status: 403 });
  }

  const { conversationId } = await params;
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  let body: { type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido" },
      { status: 400 }
    );
  }

  const type = body.type === "good" || body.type === "bad" ? body.type : null;
  if (!type) {
    return NextResponse.json(
      { error: "Campo type deve ser 'good' ou 'bad'" },
      { status: 400 }
    );
  }

  const lastFaqId = await getLastUsedFaqId(conversationId);
  if (lastFaqId) {
    const delta = type === "good" ? 10 : -10;
    await updateFaqConfidence(lastFaqId, delta);
    await clearLastUsedFaqId(conversationId);
    return NextResponse.json({
      ok: true,
      type,
      target: "faq",
      faqUpdated: true,
    });
  }

  const exampleIds = await getLastUsedExampleIds(conversationId);
  if (exampleIds.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Nenhuma resposta da IA/FAQ para avaliar",
    });
  }

  const delta = type === "good" ? 10 : -15;
  for (const id of exampleIds) {
    await updateQualityScore(id, delta);
  }
  await clearLastUsedExampleIds(conversationId);

  return NextResponse.json({
    ok: true,
    type,
    target: "examples",
    examplesUpdated: exampleIds.length,
  });
}
