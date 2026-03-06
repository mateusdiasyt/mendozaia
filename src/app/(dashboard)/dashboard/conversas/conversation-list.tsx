"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Search } from "lucide-react";
import { ContactAvatar } from "@/components/conversations/contact-avatar";

interface Conv {
  id: string;
  lastMessageAt: Date | string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  contactName: string | null;
  contactPhone: string;
  sessionId: string;
  isWaitingHuman: boolean;
  isTyping?: boolean;
}

const POLL_INTERVAL_MS = 1_500;
const POLL_WHEN_HIDDEN_MS = 8_000;
const ENTER_ANIMATION_MS = 450;

export function ConversationList({ list }: { list: Conv[] }) {
  const pathname = usePathname();
  const [items, setItems] = useState<Conv[]>(list);
  const [tab, setTab] = useState<"active" | "waiting">("active");
  const [query, setQuery] = useState("");
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const previousIndexByIdRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setItems(list);
  }, [list]);

  const fetchConversationList = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations/list", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { list?: Conv[] };
      if (Array.isArray(data.list)) {
        setItems(data.list);
      }
    } catch {
      // ignore transient polling failures
    }
  }, []);

  useEffect(() => {
    fetchConversationList();
    let intervalId: ReturnType<typeof setInterval>;

    const schedulePoll = () => {
      const ms = document.hidden ? POLL_WHEN_HIDDEN_MS : POLL_INTERVAL_MS;
      intervalId = setInterval(fetchConversationList, ms);
    };

    schedulePoll();

    const onVisibilityChange = () => {
      clearInterval(intervalId);
      if (!document.hidden) {
        fetchConversationList();
      }
      schedulePoll();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchConversationList]);

  const waitingList = useMemo(
    () => items.filter((c) => c.isWaitingHuman),
    [items]
  );
  const activeList = useMemo(
    () => items.filter((c) => !c.isWaitingHuman),
    [items]
  );

  const baseList = tab === "waiting" ? waitingList : activeList;
  const normalizedQuery = query.trim().toLowerCase();
  const currentList = useMemo(() => {
    if (!normalizedQuery) return baseList;
    return baseList.filter((conv) => {
      const displayName = (conv.contactName || conv.contactPhone).toLowerCase();
      const preview = (conv.lastMessagePreview ?? "").toLowerCase();
      const phone = conv.contactPhone.toLowerCase();
      return (
        displayName.includes(normalizedQuery) ||
        preview.includes(normalizedQuery) ||
        phone.includes(normalizedQuery)
      );
    });
  }, [baseList, normalizedQuery]);

  useEffect(() => {
    const currentIndexById = new Map<string, number>();
    for (let i = 0; i < items.length; i++) {
      currentIndexById.set(items[i]!.id, i);
    }

    const idsToAnimate: string[] = [];
    const previousIndexById = previousIndexByIdRef.current;
    for (const [id, currentIndex] of currentIndexById.entries()) {
      const previousIndex = previousIndexById.get(id);
      const isNew = previousIndex === undefined;
      const movedUp = previousIndex !== undefined && currentIndex < previousIndex;
      if (isNew || movedUp) {
        idsToAnimate.push(id);
      }
    }

    if (idsToAnimate.length > 0) {
      setAnimatingIds((prev) => {
        const next = new Set(prev);
        idsToAnimate.forEach((id) => next.add(id));
        return next;
      });

      const timer = setTimeout(() => {
        setAnimatingIds((prev) => {
          const next = new Set(prev);
          idsToAnimate.forEach((id) => next.delete(id));
          return next;
        });
      }, ENTER_ANIMATION_MS);

      previousIndexByIdRef.current = currentIndexById;
      return () => clearTimeout(timer);
    }

    previousIndexByIdRef.current = currentIndexById;
  }, [items]);

  return (
    <div className="flex w-[400px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 shadow-sm">
          <MessageSquare className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900">Conversas</h2>
          <p className="text-xs text-slate-500">Caixa de entrada</p>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar conversa, numero ou mensagem"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "active"
              ? "bg-emerald-100 text-emerald-900"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Aguardando atendimento ({waitingList.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {currentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-16">
            <div className="rounded-full bg-slate-100 p-4">
              <MessageSquare className="h-10 w-10 text-slate-400" />
            </div>
            <p className="text-center font-medium text-slate-900">
              {normalizedQuery
                ? "Nenhum resultado encontrado"
                : tab === "waiting"
                  ? "Nenhuma conversa aguardando atendimento"
                  : "Nenhuma conversa ativa"}
            </p>
            <p className="max-w-xs text-center text-sm text-slate-500">
              {normalizedQuery
                ? "Tente buscar por outro nome, numero ou trecho da mensagem."
                : tab === "waiting"
                  ? "Quando a IA encaminhar para atendimento humano, as conversas aparecerao aqui."
                  : "As conversas aparecerao aqui quando voce receber mensagens no WhatsApp conectado."}
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
                className={`flex items-center gap-3 border-b border-slate-100 px-4 py-3 transition-colors ${
                  isActive ? "bg-emerald-50/60" : "hover:bg-slate-50"
                }`}
                style={
                  animatingIds.has(conv.id)
                    ? {
                        animation:
                          "conversation-entry 450ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }
                    : undefined
                }
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
                    <span className="truncate text-base font-semibold text-slate-900">
                      {displayName}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="shrink-0 text-xs text-slate-500">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {conv.isTyping ? (
                      <span className="font-medium text-emerald-600">digitando...</span>
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
      <style jsx>{`
        @keyframes conversation-entry {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.985);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function formatTime(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Agora";
  if (diffMins < 60) return `${diffMins}min`;
  if (diffHours < 24)
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
