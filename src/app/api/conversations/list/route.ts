import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { conversations, contacts, whatsappSessions } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";

function parseNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseNonNegativeInt(searchParams.get("limit"), 50) || 50, 100);
  const offset = parseNonNegativeInt(searchParams.get("offset"), 0);

  const rows = await db
    .select({
      id: conversations.id,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: conversations.lastMessagePreview,
      unreadCount: conversations.unreadCount,
      contactTypingAt: conversations.contactTypingAt,
      conversationState: conversations.conversationState,
      isPriority: conversations.isPriority,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      sessionId: whatsappSessions.sessionId,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .innerJoin(
      whatsappSessions,
      eq(conversations.whatsappSessionId, whatsappSessions.id)
    )
    .where(
      and(
        eq(conversations.organizationId, org.id),
        eq(contacts.organizationId, org.id),
        eq(whatsappSessions.organizationId, org.id),
        eq(conversations.isArchived, false)
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const nowMs = Date.now();
  const CONTACT_TYPING_TIMEOUT_MS = 12_000;
  const listWithStatus = page.map((item) => {
    const isTyping =
      !!item.contactTypingAt &&
      nowMs - new Date(item.contactTypingAt).getTime() < CONTACT_TYPING_TIMEOUT_MS;

    return {
      ...item,
      isTyping,
      isWaitingHuman:
        item.conversationState === "waiting_human" ||
        item.conversationState === "human_active" ||
        item.isPriority === true,
    };
  });

  return NextResponse.json({ list: listWithStatus, hasMore });
}
