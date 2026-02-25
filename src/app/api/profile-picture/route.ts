import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchProfilePictureUrl } from "@/lib/evolution-api";

/**
 * GET /api/profile-picture?conversationId=xxx
 * ou
 * GET /api/profile-picture?sessionId=xxx&phone=xxx
 *
 * Retorna { url: string } ou { url: null } se não houver foto.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const org = await getCurrentOrganization();
  if (!org) {
    return NextResponse.json({ error: "Organização não encontrada" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId");
  const sessionId = searchParams.get("sessionId");
  const phone = searchParams.get("phone");

  let instanceName: string;
  let contactPhone: string;

  if (conversationId) {
    const [conv] = await db
      .select({
        contactPhone: contacts.phone,
        instanceSessionId: whatsappSessions.sessionId,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .innerJoin(whatsappSessions, eq(conversations.whatsappSessionId, whatsappSessions.id))
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.organizationId, org.id)
        )
      )
      .limit(1);

    if (!conv) {
      return NextResponse.json({ url: null });
    }
    instanceName = conv.instanceSessionId;
    contactPhone = conv.contactPhone;
  } else if (sessionId && phone) {
    const [ws] = await db
      .select()
      .from(whatsappSessions)
      .where(
        and(
          eq(whatsappSessions.sessionId, sessionId),
          eq(whatsappSessions.organizationId, org.id)
        )
      )
      .limit(1);

    if (!ws) {
      return NextResponse.json({ url: null });
    }
    instanceName = sessionId;
    contactPhone = phone;
  } else {
    return NextResponse.json({ error: "conversationId ou (sessionId + phone) obrigatório" }, { status: 400 });
  }

  try {
    const url = await fetchProfilePictureUrl(instanceName, contactPhone);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ url: null });
  }
}
