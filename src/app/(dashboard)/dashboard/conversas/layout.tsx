import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { ConversationList } from "./conversation-list";

export default async function ConversasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const list = await db
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
    .innerJoin(whatsappSessions, eq(conversations.whatsappSessionId, whatsappSessions.id))
    .where(
      and(
        eq(conversations.organizationId, org.id),
        eq(contacts.organizationId, org.id),
        eq(whatsappSessions.organizationId, org.id),
        eq(conversations.isArchived, false)
      )
    )
    .orderBy(desc(conversations.lastMessageAt));

  const nowMs = Date.now();
  const CONTACT_TYPING_TIMEOUT_MS = 12_000;
  const listWithStatus = list.map((item) => {
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

  return (
    <div className="flex min-h-0 w-full flex-1 shrink-0">
      <ConversationList list={listWithStatus} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--brand-surface)]">
        {children}
      </div>
    </div>
  );
}
