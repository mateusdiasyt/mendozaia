/**
 * Endpoint para cron (Vercel Cron ou externo).
 * Processa regras de follow-up (no_reply_timeout) para todas as organizações.
 * Proteger com CRON_SECRET nas variáveis de ambiente.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processNoReplyTimeoutRules } from "@/lib/automation/engine";

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

    for (const org of orgs) {
      await processNoReplyTimeoutRules(org.id);
    }

    return NextResponse.json({
      ok: true,
      processed: orgs.length,
    });
  } catch (err) {
    console.error("[cron automation-followup]", err);
    return NextResponse.json(
      { error: "Cron failed" },
      { status: 500 }
    );
  }
}
