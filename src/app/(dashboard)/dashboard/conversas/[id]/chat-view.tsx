"use client";

import { useState, useRef, useEffect } from "react";
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

export function ChatView({
  conversationId,
  initialMessages,
}: ChatViewProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setInput("");

    try {
      await sendMessage(conversationId, text);
      setMessages((prev) => [
        ...prev,
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
      {/* Fundo com padrão sutil - pointer-events-none para não bloquear cliques */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23667781' fill-opacity='0.5'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto p-6 space-y-2"
      >
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#667781]">
            Nenhuma mensagem ainda. Envie a primeira!
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.direction === "outbound" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[65%] rounded-lg px-3 py-2 shadow-sm ${
                  msg.direction === "outbound"
                    ? "bg-[#d9fdd3] text-[#111b21]"
                    : "bg-white text-[#111b21] shadow-md"
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
                      className="text-sm underline text-[#00a884]"
                    >
                      [{msg.contentType}]
                    </a>
                  )
                ) : (
                  <p className="text-sm opacity-70">[Mídia]</p>
                )}
                <div className="mt-1 flex items-center justify-end gap-1">
                  <span className="text-[10px] text-[#667781]">
                    {new Date(msg.createdAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {msg.direction === "outbound" && (
                    <span className="text-[#53bdeb]">
                      <svg className="h-4 w-4" viewBox="0 0 16 15" fill="currentColor">
                        <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.063-.51zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.892 7.77a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .006.514l3.255 3.185a.32.32 0 0 0 .484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z" />
                      </svg>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="relative z-10 shrink-0 border-t border-[#e9edef] bg-[#f0f2f5] p-3"
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
            className="flex-1 rounded-lg border-0 bg-white px-4 py-3 text-[#111b21] shadow-sm placeholder-[#667781] focus:outline-none focus:ring-1 focus:ring-[#00a884] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition-colors hover:bg-[#06cf9c] disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
