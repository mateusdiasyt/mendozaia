"use client";

import { useState, useEffect } from "react";
import {
  Bot,
  BotOff,
  ChevronDown,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  setConversationAIDisabled,
  setConversationAIEnabled,
  setConversationCarInShop,
  resetConversationForTesting,
} from "@/app/actions/messages";
import { useRouter } from "next/navigation";
import { AI_DISABLE_DURATIONS } from "@/lib/conversation-ai";

interface AIControlSidebarProps {
  conversationId: string;
  aiDisabledUntil: Date | string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
  vehicleKm?: string | null;
  carInShop?: boolean;
}

export function AIControlSidebar({
  conversationId,
  aiDisabledUntil,
  vehicleModel,
  vehicleYear,
  vehicleKm,
  carInShop = false,
}: AIControlSidebarProps) {
  const router = useRouter();
  const [until, setUntil] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingWorkshop, setUpdatingWorkshop] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [carInWorkshop, setCarInWorkshop] = useState(carInShop);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setUntil(aiDisabledUntil ? new Date(aiDisabledUntil) : null);
  }, [aiDisabledUntil]);

  useEffect(() => {
    setCarInWorkshop(carInShop);
  }, [carInShop]);

  const isDisabled = mounted && until && until > new Date();
  const isForever =
    until &&
    until.getTime() - Date.now() > 365 * 24 * 60 * 60 * 1000; // mais de 1 ano
  const untilFormatted =
    mounted && until && isDisabled
      ? isForever
        ? "Permanente"
        : until.toLocaleString("pt-BR", {
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

  async function handleResetConversation() {
    const confirmed = window.confirm(
      "Isso vai apagar contato, conversa e mensagens deste número para testes. Deseja continuar?"
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      await resetConversationForTesting(conversationId);
      router.push("/dashboard/conversas");
      router.refresh();
    } catch {
      //
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

  async function handleSetCarInShop(nextValue: boolean) {
    setUpdatingWorkshop(true);
    try {
      await setConversationCarInShop(conversationId, nextValue);
      setCarInWorkshop(nextValue);
      if (nextValue) {
        setUntil(new Date(Date.now() + 87600 * 60 * 60 * 1000));
      } else {
        setUntil(null);
      }
    } catch {
      //
    } finally {
      setUpdatingWorkshop(false);
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
        <div className="rounded-lg border border-[#e9edef] bg-[#f8f9fa] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#667781]">
            Veículo do contato
          </p>
          <div className="mt-2 space-y-1 text-sm text-[#111b21]">
            <p>
              Modelo: <span className="font-medium">{vehicleModel || "Não informado"}</span>
            </p>
            <p>
              Ano: <span className="font-medium">{vehicleYear || "Não informado"}</span>
            </p>
            <p>
              KM: <span className="font-medium">{vehicleKm || "Não informado"}</span>
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[#e9edef] bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#667781]">
            Carro na mecânica
          </p>
          <p className="mt-1 text-xs text-[#667781]">
            Quando marcado como Sim, a IA fica desativada para atendimento humano.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={updatingWorkshop}
              onClick={() => handleSetCarInShop(true)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                carInWorkshop
                  ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                  : "border-[#e9edef] bg-white text-[#111b21] hover:bg-[#f5f6f6]"
              }`}
            >
              Sim
            </button>
            <button
              type="button"
              disabled={updatingWorkshop}
              onClick={() => handleSetCarInShop(false)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                !carInWorkshop
                  ? "border-[#00a884] bg-emerald-50 text-[#007a63]"
                  : "border-[#e9edef] bg-white text-[#111b21] hover:bg-[#f5f6f6]"
              }`}
            >
              Não
            </button>
          </div>
        </div>

        {/* Status */}
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${
            !mounted ? "bg-[#f5f6f6]" : isDisabled ? "bg-amber-50" : "bg-emerald-50"
          }`}
        >
          {!mounted ? (
            <Bot className="h-5 w-5 shrink-0 text-[#667781]" />
          ) : isDisabled ? (
            <BotOff className="h-5 w-5 shrink-0 text-amber-600" />
          ) : (
            <Bot className="h-5 w-5 shrink-0 text-emerald-600" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#111b21]">
              {!mounted ? "Carregando..." : isDisabled ? "IA desativada" : "IA ativa"}
            </p>
            <p className="text-xs text-[#667781]">
              {isDisabled && untilFormatted
                ? `Até ${untilFormatted}`
                : !mounted
                  ? "..."
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

        <button
          type="button"
          onClick={handleResetConversation}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Resetar conversa (teste)
        </button>

        {/* Info */}
        <p className="mt-auto text-xs text-[#667781]">
          Ao responder pela plataforma ou pelo WhatsApp, a IA é desativada
          automaticamente por 3 horas nesta conversa.
        </p>
      </div>
    </aside>
  );
}
