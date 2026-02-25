"use client";

import { useState, useEffect } from "react";
import {
  Bot,
  BotOff,
  ChevronDown,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  setConversationAIDisabled,
  setConversationAIEnabled,
  AI_DISABLE_DURATIONS,
} from "@/app/actions/messages";

interface AIControlSidebarProps {
  conversationId: string;
  aiDisabledUntil: Date | null;
}

export function AIControlSidebar({
  conversationId,
  aiDisabledUntil,
}: AIControlSidebarProps) {
  const [until, setUntil] = useState<Date | null>(
    aiDisabledUntil ? new Date(aiDisabledUntil) : null
  );
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    setUntil(aiDisabledUntil ? new Date(aiDisabledUntil) : null);
  }, [aiDisabledUntil]);

  const isDisabled = until && until > new Date();
  const untilFormatted = until
    ? until.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  async function handleDisable(hours: number) {
    setLoading(true);
    setDropdownOpen(false);
    try {
      const result = await setConversationAIDisabled(conversationId, hours);
      setUntil(result.aiDisabledUntil ? new Date(result.aiDisabledUntil) : null);
    } catch {
      // erro silencioso ou toast
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable() {
    setLoading(true);
    try {
      await setConversationAIEnabled(conversationId);
      setUntil(null);
    } catch {
      //
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[#e9edef] bg-white">
      <div className="border-b border-[#e9edef] px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[#111b21]">
          <Bot className="h-4 w-4 text-[#00a884]" />
          Agente de IA
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Status */}
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${
            isDisabled ? "bg-amber-50" : "bg-emerald-50"
          }`}
        >
          {isDisabled ? (
            <BotOff className="h-5 w-5 shrink-0 text-amber-600" />
          ) : (
            <Bot className="h-5 w-5 shrink-0 text-emerald-600" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#111b21]">
              {isDisabled ? "IA desativada" : "IA ativa"}
            </p>
            <p className="text-xs text-[#667781]">
              {isDisabled
                ? `Até ${untilFormatted}`
                : "Respondendo automaticamente"}
            </p>
          </div>
        </div>

        {/* Ações */}
        <div className="space-y-2">
          {isDisabled ? (
            <button
              type="button"
              onClick={handleEnable}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#00a884] bg-white px-3 py-2.5 text-sm font-medium text-[#00a884] transition-colors hover:bg-[#f0fdf4] disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Reativar agora
            </button>
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                disabled={loading}
                className="flex w-full items-center justify-between rounded-lg border border-[#e9edef] bg-white px-3 py-2.5 text-sm font-medium text-[#111b21] transition-colors hover:bg-[#f5f6f6] disabled:opacity-50"
              >
                Desativar IA
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    aria-hidden
                    onClick={() => setDropdownOpen(false)}
                  />
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-[#e9edef] bg-white py-1 shadow-lg">
                    {AI_DISABLE_DURATIONS.map(({ hours, label }) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => handleDisable(hours)}
                        className="w-full px-3 py-2 text-left text-sm text-[#111b21] hover:bg-[#f5f6f6]"
                      >
                        Por {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Info */}
        <p className="mt-auto text-xs text-[#667781]">
          Ao responder manualmente, a IA é desativada automaticamente por 3 horas
          nesta conversa.
        </p>
      </div>
    </aside>
  );
}
