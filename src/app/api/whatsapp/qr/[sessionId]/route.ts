import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { connectInstance, createInstance } from "@/lib/evolution-api";
import QRCode from "qrcode";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const org = await getCurrentOrganization();
    if (!org) {
      return NextResponse.json({ error: "Organização não encontrada" }, { status: 404 });
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
      return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
    }

    let data: { code?: string; pairingCode?: string };
    try {
      data = await connectInstance(sessionId);
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      if (status === 404) {
        const webhookUrl = process.env.NEXTAUTH_URL
          ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/api/webhooks/whatsapp`
          : undefined;
        await createInstance(sessionId, webhookUrl);
        data = await connectInstance(sessionId);
      } else {
        throw err;
      }
    }

    const code = data.code ?? data.pairingCode;

    if (!code) {
      return NextResponse.json(
        { error: "QR code não disponível. Tente novamente." },
        { status: 400 }
      );
    }

    const qrDataUrl = await QRCode.toDataURL(code, {
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });

    return NextResponse.json({ qr: qrDataUrl });
  } catch (err) {
    console.error("[api whatsapp qr]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao obter QR code" },
      { status: 500 }
    );
  }
}
