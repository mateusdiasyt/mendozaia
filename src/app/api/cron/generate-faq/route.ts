/**
 * Cron semanal: detecta perguntas repetidas e gera entradas de FAQ automaticamente.
 * Proteger com CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  detectRepeatedQuestions,
  generateFAQFromRepeatedGroup,
} from "@/lib/faq-engine";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.status, "active"));

    let totalGenerated = 0;
    for (const org of orgs) {
      const groups = await detectRepeatedQuestions(org.id);
      for (const group of groups) {
        const id = await generateFAQFromRepeatedGroup(org.id, group);
        if (id) totalGenerated++;
      }
    }

    return NextResponse.json({
      ok: true,
      organizationsProcessed: orgs.length,
      faqEntriesGenerated: totalGenerated,
    });
  } catch (err) {
    console.error("[cron generate-faq]", err);
    return NextResponse.json(
      { error: "Generate FAQ failed" },
      { status: 500 }
    );
  }
}
