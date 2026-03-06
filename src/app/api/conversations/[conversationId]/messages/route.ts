import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  messages,
} from "@/lib/db/schema";
import { eq, and, asc, gt, desc } from "drizzle-orm";

/**
 * GET /api/conversations/[conversationId]/messages
 * Retorna mensagens da conversa (para polling/atualização em tempo real).
 */
export async function GET(
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
  const { searchParams } = new URL(request.url);
  const afterParam = searchParams.get("after");
  const parsedAfter =
    afterParam && !Number.isNaN(Date.parse(afterParam))
      ? new Date(afterParam)
      : null;

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

  const msgList = await db
    .select({ message: messages })
    .from(messages)
    .where(
      parsedAfter
        ? and(
            eq(messages.conversationId, conversationId),
            gt(messages.createdAt, parsedAfter)
          )
        : eq(messages.conversationId, conversationId)
    )
    .orderBy(parsedAfter ? asc(messages.createdAt) : desc(messages.createdAt))
    .limit(parsedAfter ? 300 : 200);

  const orderedMessages = parsedAfter ? msgList : [...msgList].reverse();

  const typingAt = (conv as { contactTypingAt?: Date | null })?.contactTypingAt;
  const TYPING_TIMEOUT_MS = 12_000;
  const isTyping =
    typingAt &&
    Date.now() - new Date(typingAt).getTime() < TYPING_TIMEOUT_MS;

  return NextResponse.json({
    messages: orderedMessages.map((item) => item.message),
    typing: !!isTyping,
  });
}
