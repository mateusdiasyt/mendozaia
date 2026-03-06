"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
  setConversationHumanWaiting,
  setConversationVehicleOil,
  updateConversationContactData,
  updateConversationReservationDraft,
  resetConversationForTesting,
} from "@/app/actions/messages";
import { useRouter } from "next/navigation";
import { AI_DISABLE_DURATIONS } from "@/lib/conversation-ai";

interface AIControlSidebarProps {
  conversationId: string;
  aiDisabledUntil: Date | string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactNotes?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
  vehicleKm?: string | null;
  vehicleOilSpec?: string | null;
  reservationDateStr?: string | null;
  reservationTimeStr?: string | null;
  oilProducts?: Array<{ id: string; name: string; model: string | null }>;
  carInShop?: boolean;
  waitingHuman?: boolean;
  inHumanColumn?: boolean;
  isPriority?: boolean;
  conversationState?: string | null;
  assignedToId?: string | null;
  segment?: "mecanica" | "restaurante" | "geral";
}

export function AIControlSidebar({
  conversationId,
  aiDisabledUntil,
  contactName = null,
  contactPhone = null,
  contactEmail = null,
  contactNotes = null,
  vehicleModel,
  vehicleYear,
  vehicleKm,
  vehicleOilSpec,
  reservationDateStr = null,
  reservationTimeStr = null,
  oilProducts = [],
  carInShop = false,
  waitingHuman = false,
  inHumanColumn = false,
  isPriority = false,
  conversationState = null,
  assignedToId = null,
  segment = "mecanica",
}: AIControlSidebarProps) {
  const showVehicleControls = segment === "mecanica";
  const router = useRouter();
  const [until, setUntil] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingWorkshop, setUpdatingWorkshop] = useState(false);
  const [updatingHumanWaiting, setUpdatingHumanWaiting] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [carInWorkshop, setCarInWorkshop] = useState(carInShop);
  const [isWaitingHuman, setIsWaitingHuman] = useState(waitingHuman);
  const [oilSpec, setOilSpec] = useState(vehicleOilSpec ?? "");
  const [updatingOil, setUpdatingOil] = useState(false);
  const [editingName, setEditingName] = useState(contactName ?? "");
  const [editingEmail, setEditingEmail] = useState(contactEmail ?? "");
  const [editingNotes, setEditingNotes] = useState(contactNotes ?? "");
  const [savingContactData, setSavingContactData] = useState(false);
  const [editingReservationDate, setEditingReservationDate] = useState(
    reservationDateStr ?? ""
  );
  const [editingReservationTime, setEditingReservationTime] = useState(
    reservationTimeStr ?? ""
  );
  const [savingReservationDraft, setSavingReservationDraft] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setUntil(aiDisabledUntil ? new Date(aiDisabledUntil) : null);
  }, [aiDisabledUntil]);

  useEffect(() => {
    setCarInWorkshop(carInShop);
  }, [carInShop]);

  useEffect(() => {
    setIsWaitingHuman(waitingHuman);
  }, [waitingHuman]);

  useEffect(() => {
    setOilSpec(vehicleOilSpec ?? "");
  }, [vehicleOilSpec]);

  useEffect(() => {
    setEditingName(contactName ?? "");
  }, [contactName]);

  useEffect(() => {
    setEditingEmail(contactEmail ?? "");
  }, [contactEmail]);

  useEffect(() => {
    setEditingNotes(contactNotes ?? "");
  }, [contactNotes]);

  useEffect(() => {
    setEditingReservationDate(reservationDateStr ?? "");
  }, [reservationDateStr]);

  useEffect(() => {
    setEditingReservationTime(reservationTimeStr ?? "");
  }, [reservationTimeStr]);

  const isDisabledByTime = mounted && !!(until && until > new Date());
  const isDisabledByColumn = inHumanColumn || carInWorkshop || isWaitingHuman;
  const isDisabled = isDisabledByTime || isDisabledByColumn;
  const disabledReason = carInWorkshop
    ? "Fluxo humano: carro na mecânica"
    : isWaitingHuman
      ? "Fluxo humano: aguardando atendimento humano"
      : inHumanColumn
        ? "Conversa na coluna humana/prioritária"
        : null;
  const isForever =
    until &&
    until.getTime() - Date.now() > 365 * 24 * 60 * 60 * 1000;
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
      //
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
      router.refresh();
    } catch {
      //
    } finally {
      setUpdatingWorkshop(false);
    }
  }

  async function handleSetWaitingHuman(nextValue: boolean) {
    setUpdatingHumanWaiting(true);
    try {
      await setConversationHumanWaiting(conversationId, nextValue);
      setIsWaitingHuman(nextValue);
      if (nextValue) {
        setUntil(new Date(Date.now() + 87600 * 60 * 60 * 1000));
      } else if (!carInWorkshop) {
        setUntil(null);
      }
      router.refresh();
    } catch {
      //
    } finally {
      setUpdatingHumanWaiting(false);
    }
  }

  async function handleSetOilSpec(nextValue: string) {
    setUpdatingOil(true);
    try {
      await setConversationVehicleOil(conversationId, nextValue || null);
      setOilSpec(nextValue);
    } catch {
      //
    } finally {
      setUpdatingOil(false);
    }
  }

  async function handleSaveContactData() {
    setSavingContactData(true);
    try {
      await updateConversationContactData(conversationId, {
        name: editingName,
        email: editingEmail,
        notes: editingNotes,
      });
      router.refresh();
    } catch {
      //
    } finally {
      setSavingContactData(false);
    }
  }

  async function handleSaveReservationDraft() {
    setSavingReservationDraft(true);
    try {
      await updateConversationReservationDraft(conversationId, {
        dateStr: editingReservationDate || null,
        timeStr: editingReservationTime || null,
      });
      router.refresh();
    } catch {
      //
    } finally {
      setSavingReservationDraft(false);
    }
  }

  const formatPhone = (phone: string | null | undefined): string => {
    if (!phone) return "Não informado";
    const digits = phone.replace(/\D/g, "");
    const local =
      digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits;
    if (local.length === 11) {
      return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }
    if (local.length === 10) {
      return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    }
    return phone;
  };

  const cardClass = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
  const sectionTitleClass =
    "text-xs font-semibold uppercase tracking-[0.08em] text-slate-500";
  const selectClass =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 transition focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60";
  const oilOptionValues = oilProducts.map((item) =>
    item.model?.trim() ? item.model.trim() : item.name.trim()
  );
  const showCustomOilValue = !!oilSpec && !oilOptionValues.includes(oilSpec);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Bot className="h-5 w-5 text-emerald-600" />
          Agente de IA
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Controle do atendimento automático desta conversa
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className={cardClass}>
          <p className={sectionTitleClass}>Dados do cliente</p>
          <div className="mt-3 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Número</p>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-900">
                {formatPhone(contactPhone)}
              </div>
            </div>
            <div>
              <label
                htmlFor="contact-name"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Nome
              </label>
              <input
                id="contact-name"
                type="text"
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                disabled={savingContactData}
                className={selectClass}
                placeholder="Nome do cliente"
              />
            </div>
            <div>
              <label
                htmlFor="contact-email"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Email
              </label>
              <input
                id="contact-email"
                type="email"
                value={editingEmail}
                onChange={(event) => setEditingEmail(event.target.value)}
                disabled={savingContactData}
                className={selectClass}
                placeholder="email@cliente.com"
              />
            </div>
            <div>
              <label
                htmlFor="contact-notes"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Observações
              </label>
              <textarea
                id="contact-notes"
                value={editingNotes}
                onChange={(event) => setEditingNotes(event.target.value)}
                disabled={savingContactData}
                rows={3}
                className={`${selectClass} resize-none`}
                placeholder="Anotações importantes do cliente"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveContactData}
              disabled={savingContactData}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingContactData ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Salvar dados do cliente
            </button>
          </div>
        </div>

        <div className={cardClass}>
          <p className={sectionTitleClass}>Dados do agendamento</p>
          <div className="mt-3 space-y-3">
            <div>
              <label
                htmlFor="reservation-date"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Data do agendamento
              </label>
              <input
                id="reservation-date"
                type="date"
                value={editingReservationDate}
                onChange={(event) => setEditingReservationDate(event.target.value)}
                disabled={savingReservationDraft}
                className={selectClass}
              />
            </div>
            <div>
              <label
                htmlFor="reservation-time"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Horário do agendamento
              </label>
              <input
                id="reservation-time"
                type="time"
                value={editingReservationTime}
                onChange={(event) => setEditingReservationTime(event.target.value)}
                disabled={savingReservationDraft}
                className={selectClass}
              />
            </div>
            <button
              type="button"
              onClick={handleSaveReservationDraft}
              disabled={savingReservationDraft}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingReservationDraft ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Salvar dados do agendamento
            </button>
          </div>
        </div>

        {showVehicleControls && (
          <div className={cardClass}>
            <p className={sectionTitleClass}>Veículo do contato</p>
            <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-900">
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Modelo</span>
                <span className="font-medium">{vehicleModel || "Não informado"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Ano</span>
                <span className="font-medium">{vehicleYear || "Não informado"}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-slate-500">KM</span>
                <span className="font-medium">{vehicleKm || "Não informado"}</span>
              </div>
            </div>
            <div className="mt-3">
              <label
                htmlFor="vehicle-oil-spec"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Óleo
              </label>
              <select
                id="vehicle-oil-spec"
                disabled={updatingOil}
                value={oilSpec}
                onChange={(event) => handleSetOilSpec(event.target.value)}
                className={selectClass}
              >
                <option value="">Não informado</option>
                {showCustomOilValue ? (
                  <option value={oilSpec}>{oilSpec} (salvo)</option>
                ) : null}
                {oilProducts.map((item) => {
                  const value = item.model?.trim() ? item.model.trim() : item.name.trim();
                  const label = item.model?.trim()
                    ? `${item.model.trim()} - ${item.name}`
                    : item.name;
                  return (
                    <option key={item.id} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        <div className={cardClass}>
          <p className={sectionTitleClass}>Atendimento humano</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Marque quando a conversa estiver aguardando atendimento da equipe.
          </p>
          <div className="mt-3">
            <label
              htmlFor="waiting-human"
              className="mb-1.5 block text-xs font-medium text-slate-600"
            >
              Aguardando atendimento humano
            </label>
            <select
              id="waiting-human"
              disabled={updatingHumanWaiting}
              value={isWaitingHuman ? "yes" : "no"}
              onChange={(event) => handleSetWaitingHuman(event.target.value === "yes")}
              className={selectClass}
            >
              <option value="yes">Sim</option>
              <option value="no">Não</option>
            </select>
          </div>
        </div>

        {showVehicleControls && (
          <div className={cardClass}>
            <p className={sectionTitleClass}>Carro na mecânica</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Quando marcado como Sim, a IA fica desativada para atendimento humano.
            </p>
            <div className="mt-3">
              <label
                htmlFor="car-in-shop"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Status
              </label>
              <select
                id="car-in-shop"
                disabled={updatingWorkshop}
                value={carInWorkshop ? "yes" : "no"}
                onChange={(event) => handleSetCarInShop(event.target.value === "yes")}
                className={selectClass}
              >
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </div>
          </div>
        )}

        <div
          className={`rounded-xl border px-4 py-3 shadow-sm ${
            !mounted
              ? "border-slate-200 bg-white"
              : isDisabled
                ? "border-amber-200 bg-amber-50"
                : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`rounded-full p-2 ${
                !mounted
                  ? "bg-slate-100 text-slate-500"
                  : isDisabled
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {!mounted ? (
                <Bot className="h-4 w-4" />
              ) : isDisabled ? (
                <BotOff className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  {!mounted ? "Carregando..." : isDisabled ? "IA desativada" : "IA ativa"}
                </p>
                {mounted && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isDisabled
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {isDisabled ? "Pausada" : "Online"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {isDisabled && disabledReason
                  ? disabledReason
                  : isDisabled && untilFormatted
                    ? `Até ${untilFormatted}`
                    : !mounted
                      ? "..."
                      : "Respondendo automaticamente"}
              </p>
              {isDisabled && (isPriority || assignedToId || conversationState) && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {`state=${conversationState ?? "init"}${isPriority ? " | prioridade=true" : ""}${assignedToId ? " | atribuído" : ""}`}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          {isDisabled ? (
            <button
              type="button"
              onClick={handleEnable}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-white px-3 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {AI_DISABLE_DURATIONS.map(({ hours, label }) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => handleDisable(hours)}
                        className="w-full px-3 py-2 text-left text-sm text-slate-900 hover:bg-slate-50"
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
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          Resetar conversa (teste)
        </button>

        <Link
          href={`/dashboard/logs-ia?conversationId=${conversationId}`}
          className="flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
        >
          Ver logs IA desta conversa
        </Link>

        <div className="mt-auto rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs leading-relaxed text-slate-600">
            Ao responder pela plataforma ou pelo WhatsApp, a IA é desativada
            automaticamente por 3 horas nesta conversa.
          </p>
        </div>
      </div>
    </aside>
  );
}
