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
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-4"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
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
                className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                  msg.direction === "outbound"
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-800 text-zinc-100"
                }`}
              >
                {msg.contentType === "text" && msg.content ? (
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                ) : msg.mediaUrl ? (
                  msg.contentType === "image" ? (
                    <img
                      src={msg.mediaUrl}
                      alt=""
                      className="max-h-48 rounded-lg"
                    />
                  ) : msg.contentType === "audio" ? (
                    <audio controls src={msg.mediaUrl} className="max-w-full" />
                  ) : (
                    <a
                      href={msg.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline"
                    >
                      [{msg.contentType}]
                    </a>
                  )
                ) : (
                  <p className="text-sm opacity-70">[Mídia]</p>
                )}
                <p
                  className={`mt-1 text-xs ${
                    msg.direction === "outbound"
                      ? "text-indigo-200"
                      : "text-zinc-500"
                  }`}
                >
                  {new Date(msg.createdAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-800 p-4"
      >
        {error && (
          <p className="mb-2 text-sm text-red-400">{error}</p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite sua mensagem..."
            disabled={loading}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-white hover:bg-indigo-500 disabled:opacity-50"
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
