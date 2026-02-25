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
      <div className="border-b border-slate-200 bg-white px-8 py-6">
        <h1 className="text-2xl font-semibold text-slate-900">Conversas</h1>
        <p className="mt-1 text-slate-500">Caixa de entrada</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <div className="rounded-2xl bg-slate-100 p-5">
              <MessageSquare className="h-12 w-12 text-slate-400" />
            </div>
            <p className="font-medium text-slate-700">Nenhuma conversa ainda</p>
            <p className="max-w-sm text-center text-sm text-slate-500">
              As conversas aparecerão aqui quando você receber mensagens no
              WhatsApp conectado.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {list.map((conv) => (
              <Link
                key={conv.id}
                href={`/dashboard/conversas/${conv.id}`}
                className="block bg-white px-8 py-4 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">
                        {conv.contactName || conv.contactPhone}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-xs font-medium text-white">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {conv.lastMessagePreview || "Sem mensagens"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {conv.lastMessageAt && (
                      <span className="text-xs text-slate-400">
                        {formatRelativeTime(conv.lastMessageAt)}
                      </span>
                    )}
                    {conv.sessionName && (
                      <span className="ml-2 block text-xs text-slate-400">
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
