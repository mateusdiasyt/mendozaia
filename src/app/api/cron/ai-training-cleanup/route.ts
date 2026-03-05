/**
 * Job semanal: remove exemplos de treinamento com usageCount = 0 e mais antigos que 60 dias (Parte 7).
 * Configurar no Vercel Cron: 0 3 * * 0 (domingo 3h) ou similar.
 */

import { NextRequest, NextResponse } from "next/server";
import { cleanupOldUnusedExamples } from "@/lib/ai-training";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const removed = await cleanupOldUnusedExamples();
    return NextResponse.json({
      ok: true,
      removed,
    });
  } catch (err) {
    console.error("[cron ai-training-cleanup]", err);
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500 }
    );
  }
}
