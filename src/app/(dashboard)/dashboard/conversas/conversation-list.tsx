"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Search } from "lucide-react";
import { ContactAvatar } from "@/components/conversations/contact-avatar";

interface Conv {
  id: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  contactName: string | null;
  contactPhone: string;
  sessionId: string;
  isWaitingHuman: boolean;
  isTyping?: boolean;
}

export function ConversationList({ list }: { list: Conv[] }) {
  const pathname = usePathname();
  const [tab, setTab] = useState<"active" | "waiting">("active");
  const waitingList = useMemo(() => list.filter((c) => c.isWaitingHuman), [list]);
  const activeList = useMemo(() => list.filter((c) => !c.isWaitingHuman), [list]);
  const currentList = tab === "waiting" ? waitingList : activeList;

  return (
    <div className="flex w-[400px] shrink-0 flex-col border-r border-[#e9edef] bg-white">
      {/* Header */}
      <div className="flex h-16 items-center gap-3 border-b border-[#e9edef] bg-[#f0f2f5] px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884]">
          <MessageSquare className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-medium text-[#111b21]">Conversas</h2>
          <p className="text-xs text-[#667781]">Caixa de entrada</p>
        </div>
        <button
          type="button"
          className="rounded-full p-2 text-[#667781] transition-colors hover:bg-[#e9edef] hover:text-[#111b21]"
          title="Buscar"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#e9edef] bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "active"
              ? "bg-[#d9fdd3] text-[#02543f]"
              : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"
          }`}
        >
          Ativas ({activeList.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("waiting")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "waiting"
              ? "bg-amber-100 text-amber-900"
              : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"
          }`}
        >
          Aguardando atendimento ({waitingList.length})
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {currentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-16">
            <div className="rounded-full bg-[#f0f2f5] p-4">
              <MessageSquare className="h-10 w-10 text-[#667781]" />
            </div>
            <p className="text-center font-medium text-[#111b21]">
              {tab === "waiting"
                ? "Nenhuma conversa aguardando atendimento"
                : "Nenhuma conversa ativa"}
            </p>
            <p className="max-w-xs text-center text-sm text-[#667781]">
              {tab === "waiting"
                ? "Quando a IA encaminhar para atendimento humano, as conversas aparecerão aqui."
                : "As conversas aparecerão aqui quando você receber mensagens no WhatsApp conectado."}
            </p>
          </div>
        ) : (
          currentList.map((conv) => {
            const isActive = pathname === `/dashboard/conversas/${conv.id}`;
            const displayName = conv.contactName || conv.contactPhone;

            return (
              <Link
                key={conv.id}
                href={`/dashboard/conversas/${conv.id}`}
                className={`flex items-center gap-4 px-4 py-3 transition-colors ${
                  isActive ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
                }`}
              >
                <ContactAvatar
                  sessionId={conv.sessionId}
                  phone={conv.contactPhone}
                  displayName={displayName}
                  size="md"
                  conversationId={conv.id}
                  unreadCount={conv.unreadCount}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-[#111b21]">
                      {displayName}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="shrink-0 text-xs text-[#667781]">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-[#667781]">
                    {conv.isTyping ? (
                      <span className="font-medium text-[#00a884]">digitando...</span>
                    ) : (
                      conv.lastMessagePreview || "Sem mensagens"
                    )}
                  </p>
                  {conv.isWaitingHuman && (
                    <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                      Aguardando humano
                    </p>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Agora";
  if (diffMins < 60) return `${diffMins}min`;
  if (diffHours < 24) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
