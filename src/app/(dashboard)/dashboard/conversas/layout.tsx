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
      contactName: contacts.name,
      contactPhone: contacts.phone,
      sessionName: whatsappSessions.name,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .innerJoin(whatsappSessions, eq(conversations.whatsappSessionId, whatsappSessions.id))
    .where(
      and(
        eq(conversations.organizationId, org.id),
        eq(conversations.isArchived, false)
      )
    )
    .orderBy(desc(conversations.lastMessageAt));

  return (
    <div className="flex h-[calc(100vh-0px)] min-h-[500px] w-full shrink-0">
      <ConversationList list={list} />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden bg-[#0b141a]">
        {children}
      </div>
    </div>
  );
}
