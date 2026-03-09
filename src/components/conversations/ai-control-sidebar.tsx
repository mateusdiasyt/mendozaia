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

  const cardClass =
    "rounded-xl border border-[var(--brand-muted)]/25 bg-white p-4 shadow-sm";
  const sectionTitleClass =
    "text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-muted)]";
  const selectClass =
    "w-full rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2.5 text-sm text-[var(--brand-deep)] transition focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15 disabled:cursor-not-allowed disabled:opacity-60";
  const oilOptionValues = oilProducts.map((item) =>
    item.model?.trim() ? item.model.trim() : item.name.trim()
  );
  const showCustomOilValue = !!oilSpec && !oilOptionValues.includes(oilSpec);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--brand-muted)]/25 bg-[var(--brand-surface)]">
      <div className="border-b border-[var(--brand-muted)]/20 bg-[var(--brand-soft)] px-5 py-4">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--brand-deep)]">
          <Bot className="h-5 w-5 text-[var(--brand-primary)]" />
          Agente de IA
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className={cardClass}>
          <p className={sectionTitleClass}>Dados do cliente</p>
          <div className="mt-2 space-y-2">
            <div>
              <p className="mb-1 text-xs font-medium text-[var(--brand-muted)]">Número</p>
              <div className="rounded-lg border border-[var(--brand-muted)]/20 bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
                {formatPhone(contactPhone)}
              </div>
            </div>
            <div>
              <label
                htmlFor="contact-name"
                className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
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
            <button
              type="button"
              onClick={handleSaveContactData}
              disabled={savingContactData}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingContactData ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Salvar nome
            </button>
          </div>
        </div>

        {showVehicleControls && (
          <div className={cardClass}>
            <p className={sectionTitleClass}>Veículo do contato</p>
            <div className="mt-2 rounded-lg border border-[var(--brand-muted)]/20 bg-[var(--brand-soft)] p-2">
              <div className="grid grid-cols-3 gap-2 text-xs text-[var(--brand-deep)]">
                <div>
                  <p className="text-[11px] text-[var(--brand-muted)]">Modelo</p>
                  <p className="font-medium">{vehicleModel || "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--brand-muted)]">Ano</p>
                  <p className="font-medium">{vehicleYear || "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--brand-muted)]">KM</p>
                  <p className="font-medium">{vehicleKm || "-"}</p>
                </div>
              </div>
              <div className="mt-2">
                <label
                  htmlFor="vehicle-oil-spec"
                  className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
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
          </div>
        )}

        <div className={cardClass}>
          <p className={sectionTitleClass}>Dados do agendamento</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="reservation-date"
                className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
              >
                Data
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
                className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
              >
                Horário
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
              className="col-span-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingReservationDraft ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Salvar agendamento
            </button>
          </div>
        </div>

        <details className={cardClass}>
          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-muted)]">
            Mais opções
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <label
                htmlFor="contact-email"
                className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
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
                className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
              >
                Observações
              </label>
              <textarea
                id="contact-notes"
                value={editingNotes}
                onChange={(event) => setEditingNotes(event.target.value)}
                disabled={savingContactData}
                rows={2}
                className={`${selectClass} resize-none`}
                placeholder="Anotações"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="waiting-human"
                  className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
                >
                  Humano
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
              {showVehicleControls && (
                <div>
                  <label
                    htmlFor="car-in-shop"
                    className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
                  >
                    Na mecânica
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
              )}
            </div>
          </div>
        </details>

        <div
          className={`rounded-xl border px-4 py-3 shadow-sm ${
            !mounted
              ? "border-[var(--brand-muted)]/25 bg-white"
              : isDisabled
                ? "border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10"
                : "border-[var(--brand-primary)]/25 bg-[var(--brand-primary)]/10"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`rounded-full p-2 ${
                !mounted
                  ? "bg-[var(--brand-soft)] text-[var(--brand-muted)]"
                  : isDisabled
                    ? "bg-[var(--brand-accent)]/25 text-[var(--brand-deep)]"
                    : "bg-[var(--brand-primary)]/20 text-[var(--brand-primary)]"
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
                <p className="text-sm font-semibold text-[var(--brand-deep)]">
                  {!mounted ? "Carregando..." : isDisabled ? "IA desativada" : "IA ativa"}
                </p>
                {mounted && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isDisabled
                        ? "bg-[var(--brand-accent)]/25 text-[var(--brand-deep)]"
                        : "bg-[var(--brand-primary)]/20 text-[var(--brand-primary)]"
                    }`}
                  >
                    {isDisabled ? "Pausada" : "Online"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--brand-muted)]">
                {isDisabled && disabledReason
                  ? disabledReason
                  : isDisabled && untilFormatted
                    ? `Até ${untilFormatted}`
                    : !mounted
                      ? "..."
                      : "Respondendo automaticamente"}
              </p>
              {isDisabled && (isPriority || assignedToId || conversationState) && (
                <p className="mt-1 text-[11px] text-[var(--brand-muted)]">
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
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand-primary)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary)]/10 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="flex w-full items-center justify-between rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2.5 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-60"
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
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-[var(--brand-muted)]/30 bg-white py-1 shadow-lg">
                    {AI_DISABLE_DURATIONS.map(({ hours, label }) => (
                      <button
                        key={hours}
                        type="button"
                        onClick={() => handleDisable(hours)}
                        className="w-full px-3 py-2 text-left text-sm text-[var(--brand-deep)] hover:bg-[var(--brand-soft)]"
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

        <details className="rounded-lg border border-[var(--brand-muted)]/30 bg-white p-2">
          <summary className="cursor-pointer list-none px-1 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-muted)]">
            Ferramentas
          </summary>
          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={handleResetConversation}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Resetar conversa
            </button>

            <Link
              href={`/dashboard/logs-ia?conversationId=${conversationId}`}
              className="flex w-full items-center justify-center rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)]"
            >
              Ver logs da IA
            </Link>
          </div>
        </details>
      </div>
    </aside>
  );
}


