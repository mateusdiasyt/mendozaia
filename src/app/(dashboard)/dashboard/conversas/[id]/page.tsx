import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  messages,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ChatView } from "./chat-view";

export default async function ConversaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const org = await getCurrentOrganization();
  if (!org) return null;

  const { id } = await params;

  const [conv] = await db
    .select({
      id: conversations.id,
      lastMessagePreview: conversations.lastMessagePreview,
      contactId: conversations.contactId,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      sessionName: whatsappSessions.name,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .innerJoin(whatsappSessions, eq(conversations.whatsappSessionId, whatsappSessions.id))
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.organizationId, org.id)
      )
    )
    .limit(1);

  if (!conv) notFound();

  const msgList = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  await db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(conversations.id, id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-zinc-800 px-6 py-4">
        <Link
          href="/dashboard/conversas"
          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-medium text-white">
            {conv.contactName || conv.contactPhone}
          </h1>
          <p className="truncate text-sm text-zinc-400">
            {conv.contactPhone}
            {conv.sessionName && ` · ${conv.sessionName}`}
          </p>
        </div>
      </div>

      <ChatView
        conversationId={id}
        initialMessages={msgList}
      />
    </div>
  );
}
