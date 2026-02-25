import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import {
  conversations,
  contacts,
  whatsappSessions,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

export default async function ConversasPage() {
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
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 p-6">
        <h1 className="text-2xl font-semibold text-white">Conversas</h1>
        <p className="mt-1 text-zinc-400">Caixa de entrada</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="rounded-full bg-zinc-800/50 p-4">
              <MessageSquare className="h-12 w-12 text-zinc-500" />
            </div>
            <p className="text-zinc-400">Nenhuma conversa ainda</p>
            <p className="max-w-sm text-center text-sm text-zinc-500">
              As conversas aparecerão aqui quando você receber mensagens no
              WhatsApp conectado.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {list.map((conv) => (
              <Link
                key={conv.id}
                href={`/dashboard/conversas/${conv.id}`}
                className="block px-6 py-4 transition-colors hover:bg-zinc-800/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">
                        {conv.contactName || conv.contactPhone}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs font-medium text-white">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-zinc-400">
                      {conv.lastMessagePreview || "Sem mensagens"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {conv.lastMessageAt && (
                      <span className="text-xs text-zinc-500">
                        {formatRelativeTime(conv.lastMessageAt)}
                      </span>
                    )}
                    {conv.sessionName && (
                      <span className="ml-2 block text-xs text-zinc-600">
                        {conv.sessionName}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Agora";
  if (diffMins < 60) return `${diffMins}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}
