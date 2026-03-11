"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, Loader2, MessageSquare, Search, Square, Trash2, X } from "lucide-react";
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

const PAGE_SIZE = 5;
const POLL_INTERVAL_MS = 1_500;
const POLL_WHEN_HIDDEN_MS = 8_000;
const ENTER_ANIMATION_MS = 450;

export function ConversationList({
  list,
  initialHasMore,
}: {
  list: Conv[];
  initialHasMore: boolean;
}) {
  const pathname = usePathname();
  const [items, setItems] = useState<Conv[]>(list);
  const [currentLimit, setCurrentLimit] = useState<number>(Math.max(PAGE_SIZE, list.length));
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [openDeleteConfirm, setOpenDeleteConfirm] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "waiting">("active");
  const [query, setQuery] = useState("");
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const previousIndexByIdRef = useRef<Map<string, number>>(new Map());
  const desiredLimitRef = useRef<number>(Math.max(PAGE_SIZE, list.length));
  const isLoadingMoreRef = useRef<boolean>(false);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  useEffect(() => {
    desiredLimitRef.current = Math.max(PAGE_SIZE, list.length);
    setItems(list);
    setCurrentLimit(Math.max(PAGE_SIZE, list.length));
    setHasMore(initialHasMore);
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  }, [list, initialHasMore]);

  const fetchConversationList = useCallback(async (limit: number) => {
    try {
      const res = await fetch(`/api/conversations/list?limit=${limit}&offset=0`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { list?: Conv[]; hasMore?: boolean };
      // Evita que respostas antigas (limite menor) sobrescrevam o estado expandido.
      if (limit < desiredLimitRef.current) return;
      if (Array.isArray(data.list)) {
        setItems(data.list);
        setHasMore(Boolean(data.hasMore));
      }
    } catch {
      // ignore transient polling failures
    }
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    const nextLimit = currentLimit + PAGE_SIZE;
    desiredLimitRef.current = nextLimit;
    setCurrentLimit(nextLimit);
    setIsLoadingMore(true);
    try {
      await fetchConversationList(nextLimit);
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentLimit, fetchConversationList, hasMore, isLoadingMore]);

  const toggleSelectConversation = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0 || isDeletingSelected) return;
    const ids = Array.from(selectedIds);

    setIsDeletingSelected(true);
    setDeleteErrorMessage(null);
    try {
      const res = await fetch("/api/conversations/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        setDeleteErrorMessage("Nao foi possivel excluir as conversas. Tente novamente.");
        return;
      }
      await fetchConversationList(currentLimit);
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setOpenDeleteConfirm(false);
    } catch {
      setDeleteErrorMessage("Nao foi possivel excluir as conversas. Tente novamente.");
    } finally {
      setIsDeletingSelected(false);
    }
  }, [currentLimit, fetchConversationList, isDeletingSelected, selectedIds]);

  useEffect(() => {
    fetchConversationList(currentLimit);
    let intervalId: ReturnType<typeof setInterval>;

    const schedulePoll = () => {
      const ms = document.hidden ? POLL_WHEN_HIDDEN_MS : POLL_INTERVAL_MS;
      intervalId = setInterval(() => {
        if (isLoadingMoreRef.current) return;
        fetchConversationList(currentLimit);
      }, ms);
    };

    schedulePoll();

    const onVisibilityChange = () => {
      clearInterval(intervalId);
      if (!document.hidden) {
        fetchConversationList(currentLimit);
      }
      schedulePoll();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [currentLimit, fetchConversationList]);

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
    <div className="flex w-[400px] shrink-0 flex-col border-r border-[var(--brand-muted)]/25 bg-[var(--brand-surface)]">
      <div className="flex h-16 items-center gap-3 border-b border-[var(--brand-muted)]/20 bg-[var(--brand-soft)] px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary)] shadow-sm">
          <MessageSquare className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">Conversas</h2>
          <p className="text-xs text-[var(--brand-muted)]">Caixa de entrada</p>
        </div>
      </div>

      <div className="border-b border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar conversa, numero ou mensagem"
            className="w-full rounded-lg border border-[var(--brand-muted)]/30 bg-white py-2 pl-9 pr-3 text-sm text-[var(--brand-deep)] placeholder:text-[var(--brand-muted)] focus:border-[var(--brand-primary)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-[var(--brand-muted)]/20 bg-[var(--brand-surface)] px-3 py-2">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "active"
              ? "bg-[var(--brand-primary)] text-white"
              : "bg-white text-[var(--brand-muted)] hover:bg-[var(--brand-soft)]"
          }`}
        >
          Ativas ({activeList.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("waiting")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "waiting"
              ? "bg-[var(--brand-accent)] text-[var(--brand-deep)]"
              : "bg-white text-[var(--brand-muted)] hover:bg-[var(--brand-soft)]"
          }`}
        >
          Aguardando atendimento ({waitingList.length})
        </button>
        <button
          type="button"
          onClick={toggleSelectionMode}
          title={isSelectionMode ? "Sair da selecao" : "Selecionar conversas"}
          className={`ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
            isSelectionMode
              ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
              : "border-transparent bg-[var(--brand-soft)] text-[var(--brand-muted)] hover:border-[var(--brand-muted)]/25 hover:bg-white"
          }`}
        >
          {isSelectionMode ? (
            <CheckSquare className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {isSelectionMode && (
        <div className="flex items-center gap-1.5 border-b border-[var(--brand-muted)]/15 bg-[var(--brand-soft)]/55 px-3 py-1.5">
          <span className="text-[11px] text-[var(--brand-muted)]">
            {selectedIds.size} selecionada(s)
          </span>
          <button
            type="button"
            onClick={() => {
              if (selectedIds.size === 0 || isDeletingSelected) return;
              setDeleteErrorMessage(null);
              setOpenDeleteConfirm(true);
            }}
            title="Excluir selecionadas"
            disabled={selectedIds.size === 0 || isDeletingSelected}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeletingSelected ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleSelectionMode}
            title="Cancelar selecao"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--brand-muted)]/25 bg-white text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {currentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-16">
            <div className="rounded-full bg-[var(--brand-soft)] p-4">
              <MessageSquare className="h-10 w-10 text-[var(--brand-muted)]" />
            </div>
            <p className="text-center font-medium text-[var(--brand-deep)]">
              {normalizedQuery
                ? "Nenhum resultado encontrado"
                : tab === "waiting"
                  ? "Nenhuma conversa aguardando atendimento"
                  : "Nenhuma conversa ativa"}
            </p>
            <p className="max-w-xs text-center text-sm text-[var(--brand-muted)]">
              {normalizedQuery
                ? "Tente buscar por outro nome, numero ou trecho da mensagem."
                : tab === "waiting"
                  ? "Quando a IA encaminhar para atendimento humano, as conversas aparecerao aqui."
                  : "As conversas aparecerao aqui quando voce receber mensagens no WhatsApp conectado."}
            </p>
          </div>
        ) : (
          <>
            {currentList.map((conv) => {
              const isActive = pathname === `/dashboard/conversas/${conv.id}`;
              const displayName = conv.contactName || conv.contactPhone;
              const rowClass = `flex items-center gap-3 border-b border-[var(--brand-muted)]/15 px-4 py-3 transition-colors ${
                isSelectionMode
                  ? "bg-white hover:bg-[var(--brand-soft)]"
                  : isActive
                    ? "bg-[var(--brand-primary)]/10"
                    : "hover:bg-[var(--brand-soft)]"
              }`;

              const rowContent = (
                <>
                  {isSelectionMode && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSelectConversation(conv.id);
                      }}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--brand-muted)]/25 bg-white text-[var(--brand-muted)] transition-colors hover:bg-[var(--brand-soft)]"
                      aria-label={`Selecionar conversa ${displayName}`}
                    >
                      {selectedIds.has(conv.id) ? (
                        <CheckSquare className="h-4 w-4 text-[var(--brand-primary)]" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  )}
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
                      <span className="truncate text-base font-semibold text-[var(--brand-deep)]">
                        {displayName}
                      </span>
                      {conv.lastMessageAt && (
                        <span className="shrink-0 text-xs text-[var(--brand-muted)]">
                          {formatTime(conv.lastMessageAt)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-[var(--brand-muted)]">
                      {conv.isTyping ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-primary)]">
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--brand-primary)]/12">
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3 w-3 text-[var(--brand-primary)]"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M12 4C7.58 4 4 7.13 4 11c0 2.14 1.1 4.05 2.84 5.34L6 20l3.54-1.77c.77.2 1.6.31 2.46.31 4.42 0 8-3.13 8-7s-3.58-7-8-7Z" />
                            </svg>
                          </span>
                          <span className="typing-dots inline-flex">
                            <span />
                            <span />
                            <span />
                          </span>
                        </span>
                      ) : (
                        conv.lastMessagePreview || "Sem mensagens"
                      )}
                    </p>
                    {conv.isWaitingHuman && (
                      <p className="mt-1 inline-flex rounded-full bg-[var(--brand-accent)]/25 px-2 py-0.5 text-[11px] font-medium text-[var(--brand-deep)]">
                        Aguardando humano
                      </p>
                    )}
                  </div>
                </>
              );

              return isSelectionMode ? (
                <div
                  key={conv.id}
                  className={rowClass}
                  onClick={() => toggleSelectConversation(conv.id)}
                  style={
                    animatingIds.has(conv.id)
                      ? {
                          animation:
                            "conversation-entry 450ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }
                      : undefined
                  }
                >
                  {rowContent}
                </div>
              ) : (
                <Link
                  key={conv.id}
                  href={`/dashboard/conversas/${conv.id}`}
                  className={rowClass}
                  style={
                    animatingIds.has(conv.id)
                      ? {
                          animation:
                            "conversation-entry 450ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }
                      : undefined
                  }
                >
                  {rowContent}
                </Link>
              );
            })}
            {hasMore && !normalizedQuery && (
              <div className="border-b border-[var(--brand-muted)]/10 px-4 py-2.5 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="inline-flex items-center gap-2 text-xs font-medium text-[var(--brand-muted)] underline-offset-4 transition-colors hover:text-[var(--brand-deep)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingMore ? "Carregando..." : "Carregar mais 5 conversas"}
                </button>
              </div>
            )}
          </>
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
        .typing-dots {
          align-items: center;
          gap: 3px;
        }
        .typing-dots span {
          width: 5px;
          height: 5px;
          border-radius: 9999px;
          background: var(--brand-primary);
          opacity: 0.35;
          animation: typing-bounce 1.05s infinite ease-in-out;
        }
        .typing-dots span:nth-child(2) {
          animation-delay: 0.15s;
        }
        .typing-dots span:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes typing-bounce {
          0%,
          80%,
          100% {
            transform: translateY(0);
            opacity: 0.35;
          }
          40% {
            transform: translateY(-2px);
            opacity: 1;
          }
        }
      `}</style>

      {openDeleteConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#6C6C94]/40 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-[#131047]">Excluir conversas</h3>
            <p className="mt-2 text-sm text-[#6C6C94]">
              Deseja excluir {selectedIds.size} conversa(s) selecionada(s)?
            </p>
            {deleteErrorMessage ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteErrorMessage}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isDeletingSelected) return;
                  setOpenDeleteConfirm(false);
                  setDeleteErrorMessage(null);
                }}
                disabled={isDeletingSelected}
                className="rounded-xl border border-[#C8CCE5] px-4 py-2 text-sm font-medium text-[#131047] hover:bg-[#F4F5FF] disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={isDeletingSelected}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {isDeletingSelected ? "Excluindo..." : "Sim, excluir"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
