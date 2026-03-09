"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/app/actions/messages";
import { Loader2, Send } from "lucide-react";

interface Message {
  id: string;
  direction: string;
  contentType: string;
  content: string | null;
  mediaUrl: string | null;
  createdAt: Date;
}

interface ChatViewProps {
  conversationId: string;
  initialMessages: Message[];
}

const POLL_INTERVAL_MS = 1500; // 1.5 segundos
const POLL_WHEN_HIDDEN_MS = 15000; // 15 segundos quando aba em background
const MAX_RENDER_MESSAGES = 80;
const SCROLL_BOTTOM_THRESHOLD_PX = 120;

export function ChatView({
  conversationId,
  initialMessages,
}: ChatViewProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageAtRef = useRef<Date | null>(
    initialMessages.length > 0
      ? new Date(initialMessages[initialMessages.length - 1]!.createdAt)
      : null
  );
  const router = useRouter();

  const [typing, setTyping] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  useEffect(() => {
    if (initialMessages.length === 0) {
      lastMessageAtRef.current = null;
      return;
    }
    lastMessageAtRef.current = new Date(
      initialMessages[initialMessages.length - 1]!.createdAt
    );
  }, [initialMessages]);

  const fetchMessages = useCallback(async () => {
    try {
      const after = lastMessageAtRef.current;
      const qs = after ? `?after=${encodeURIComponent(after.toISOString())}` : "";
      const res = await fetch(`/api/conversations/${conversationId}/messages${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      const fetched = ((data.messages ?? []) as Message[]).map((m) => ({
        ...m,
        createdAt: new Date(m.createdAt),
      }));
      setTyping(!!data.typing);

      if (fetched.length > 0) {
        setMessages((prev) => {
          const next = [...prev];
          for (const msg of fetched) {
            const existingById = next.findIndex((m) => m.id === msg.id);
            if (existingById >= 0) continue;

            if (msg.direction === "outbound" && msg.contentType === "text" && msg.content) {
              const tempIdx = next.findIndex(
                (m) =>
                  m.id.startsWith("temp-") &&
                  m.direction === "outbound" &&
                  m.contentType === "text" &&
                  m.content === msg.content &&
                  Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) <
                    2 * 60 * 1000
              );
              if (tempIdx >= 0) {
                next[tempIdx] = msg;
                continue;
              }
            }

            next.push(msg);
          }
          return next.slice(-MAX_RENDER_MESSAGES);
        });
        lastMessageAtRef.current = new Date(
          fetched[fetched.length - 1]!.createdAt
        );
        router.refresh(); // atualiza lista de conversas
      }
    } catch {
      // ignora erros de polling
    }
  }, [conversationId, router]);

  useEffect(() => {
    fetchMessages(); // busca inicial
    let intervalId: ReturnType<typeof setInterval>;

    const schedulePoll = () => {
      const ms = document.hidden ? POLL_WHEN_HIDDEN_MS : POLL_INTERVAL_MS;
      intervalId = setInterval(fetchMessages, ms);
    };

    schedulePoll();

    const handleVisibility = () => {
      clearInterval(intervalId);
      schedulePoll();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchMessages]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, autoScrollEnabled]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScrollEnabled(distanceToBottom <= SCROLL_BOTTOM_THRESHOLD_PX);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setInput("");

    try {
      setAutoScrollEnabled(true);
      const result = await sendMessage(conversationId, text);
      if (!result.ok) {
        setError(result.error || "Erro ao enviar");
        setInput(text);
        return;
      }
      setMessages((prev) => [
        ...prev.slice(-(MAX_RENDER_MESSAGES - 1)),
        {
          id: `temp-${Date.now()}`,
          direction: "outbound",
          contentType: "text",
          content: text,
          mediaUrl: null,
          createdAt: new Date(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar");
      setInput(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Fundo com padrao sutil - pointer-events-none para nao bloquear cliques */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%236C6C94' fill-opacity='0.45'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto p-6 space-y-2"
      >
        {messages.length === 0 && !typing ? (
          <p className="py-12 text-center text-sm text-[var(--brand-muted)]">
            Nenhuma mensagem ainda. Envie a primeira!
          </p>
        ) : (
          <>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.direction === "outbound" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[65%] rounded-lg px-3 py-2 shadow-sm ${
                  msg.direction === "outbound"
                    ? "bg-[var(--brand-primary)] text-white"
                    : "bg-white text-[var(--brand-deep)] shadow-md"
                }`}
              >
                {msg.contentType === "text" && msg.content ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {msg.content}
                  </p>
                ) : msg.mediaUrl ? (
                  msg.contentType === "image" ? (
                    <img
                      src={msg.mediaUrl}
                      alt=""
                      className="max-h-56 rounded-md"
                    />
                  ) : msg.contentType === "audio" ? (
                    <audio controls src={msg.mediaUrl} className="max-w-full" />
                  ) : (
                    <a
                      href={msg.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline text-[var(--brand-primary)]"
                    >
                      [{msg.contentType}]
                    </a>
                  )
                ) : (
                  <p className="text-sm opacity-70">[MÃ­dia]</p>
                )}
                <div className="mt-1 flex items-center justify-end gap-1">
                  <span className="text-[10px] text-[var(--brand-muted)]">
                    {new Date(msg.createdAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {msg.direction === "outbound" && (
                    <span className="text-[var(--brand-accent)]">
                      <svg className="h-4 w-4" viewBox="0 0 16 15" fill="currentColor">
                        <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.063-.51zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.892 7.77a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .006.514l3.255 3.185a.32.32 0 0 0 .484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z" />
                      </svg>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start">
              <div className="max-w-[65%] rounded-2xl bg-white px-3 py-2 shadow-md">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-soft)]">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5 text-[var(--brand-muted)]"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M12 4C7.58 4 4 7.13 4 11c0 2.14 1.1 4.05 2.84 5.34L6 20l3.54-1.77c.77.2 1.6.31 2.46.31 4.42 0 8-3.13 8-7s-3.58-7-8-7Z" />
                    </svg>
                  </span>
                  <span className="typing-dots" aria-label="Cliente digitando">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="relative z-10 shrink-0 border-t border-[var(--brand-muted)]/20 bg-[var(--brand-soft)] p-3"
      >
        {error && (
          <p className="mb-2 text-sm text-red-500">{error}</p>
        )}
        <div className="flex items-end gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite uma mensagem"
            disabled={loading}
            className="flex-1 rounded-lg border border-[var(--brand-muted)]/25 bg-white px-4 py-3 text-[var(--brand-deep)] shadow-sm placeholder-[var(--brand-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary)] text-white transition-colors hover:bg-[var(--brand-deep)] disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </form>
      <style jsx>{`
        .typing-dots {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .typing-dots span {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: var(--brand-muted);
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
            transform: translateY(-3px);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}


