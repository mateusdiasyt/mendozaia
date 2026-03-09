"use client";

import { useEffect, useState } from "react";
import { Bot, BotOff, Loader2 } from "lucide-react";
import {
  setConversationAIDisabled,
  setConversationAIEnabled,
  setConversationCarInShop,
  setConversationHumanWaiting,
  setConversationVehicleOil,
  updateConversationReservationDraft,
} from "@/app/actions/messages";
import { useRouter } from "next/navigation";

interface AIControlSidebarProps {
  conversationId: string;
  aiDisabledUntil: Date | string | null;
  contactName?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
  vehicleKm?: string | null;
  vehicleOilSpec?: string | null;
  reservationDateStr?: string | null;
  reservationTimeStr?: string | null;
  reservationServiceName?: string | null;
  serviceOptions?: Array<{ id: string; name: string }>;
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
  vehicleModel,
  vehicleYear,
  vehicleKm,
  vehicleOilSpec,
  reservationDateStr = null,
  reservationTimeStr = null,
  reservationServiceName = null,
  serviceOptions = [],
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
  const [loadingToggleAI, setLoadingToggleAI] = useState(false);
  const [updatingWorkshop, setUpdatingWorkshop] = useState(false);
  const [updatingHumanWaiting, setUpdatingHumanWaiting] = useState(false);
  const [carInWorkshop, setCarInWorkshop] = useState(carInShop);
  const [isWaitingHuman, setIsWaitingHuman] = useState(waitingHuman);
  const [oilSpec, setOilSpec] = useState(vehicleOilSpec ?? "");
  const [updatingOil, setUpdatingOil] = useState(false);
  const [editingReservationDate, setEditingReservationDate] = useState(
    reservationDateStr ?? ""
  );
  const [editingReservationTime, setEditingReservationTime] = useState(
    reservationTimeStr ?? ""
  );
  const [editingReservationService, setEditingReservationService] = useState(
    reservationServiceName ?? ""
  );
  const [savingReservationDraft, setSavingReservationDraft] = useState(false);

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
    setEditingReservationDate(reservationDateStr ?? "");
  }, [reservationDateStr]);

  useEffect(() => {
    setEditingReservationTime(reservationTimeStr ?? "");
  }, [reservationTimeStr]);

  useEffect(() => {
    setEditingReservationService(reservationServiceName ?? "");
  }, [reservationServiceName]);

  const isDisabledByTime = !!(until && until > new Date());
  const isDisabledByColumn = inHumanColumn || carInWorkshop || isWaitingHuman;
  const isDisabled = isDisabledByTime || isDisabledByColumn;

  async function handleToggleAI() {
    setLoadingToggleAI(true);
    try {
      if (isDisabled) {
        await setConversationAIEnabled(conversationId);
        setUntil(null);
      } else {
        const result = await setConversationAIDisabled(conversationId, 1);
        setUntil(result.aiDisabledUntil ? new Date(result.aiDisabledUntil) : null);
      }
      router.refresh();
    } catch {
      // noop
    } finally {
      setLoadingToggleAI(false);
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
      // noop
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
      // noop
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
      // noop
    } finally {
      setUpdatingOil(false);
    }
  }

  async function handleSaveReservationDraft() {
    setSavingReservationDraft(true);
    try {
      await updateConversationReservationDraft(conversationId, {
        dateStr: editingReservationDate || null,
        timeStr: editingReservationTime || null,
        serviceName: editingReservationService || null,
      });
      router.refresh();
    } catch {
      // noop
    } finally {
      setSavingReservationDraft(false);
    }
  }

  const selectClass =
    "w-full rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2.5 text-sm text-[var(--brand-deep)] transition focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/15 disabled:cursor-not-allowed disabled:opacity-60";

  const oilOptionValues = oilProducts.map((item) =>
    item.model?.trim() ? item.model.trim() : item.name.trim()
  );
  const showCustomOilValue = !!oilSpec && !oilOptionValues.includes(oilSpec);

  return (
    <aside className="w-80 shrink-0 border-l border-[var(--brand-muted)]/25 bg-[var(--brand-surface)]">
      <div className="h-full overflow-y-auto p-3">
        <div className="rounded-xl border border-[var(--brand-muted)]/25 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-[var(--brand-deep)]">
                {isDisabled ? "IA desativada" : "IA ativa"}
              </p>
              <p className="text-xs text-[var(--brand-muted)]">
                {isDisabled ? "Pausada neste contato" : "Respondendo automaticamente"}
              </p>
            </div>
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${
                isDisabled
                  ? "border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/20 text-[var(--brand-deep)]"
                  : "border-[var(--brand-primary)]/35 bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]"
              }`}
            >
              {isDisabled ? <BotOff className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </span>
          </div>
          <button
            type="button"
            onClick={handleToggleAI}
            disabled={loadingToggleAI}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingToggleAI ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isDisabled ? "Ativar IA" : "Desativar IA"}
          </button>
        </div>

        {showVehicleControls && (
          <div className="mt-3 rounded-xl border border-[var(--brand-muted)]/25 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-muted)]">
              Veículo do contato
            </p>
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
                  {showCustomOilValue ? <option value={oilSpec}>{oilSpec} (salvo)</option> : null}
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

        <div className="mt-3 rounded-xl border border-[var(--brand-muted)]/25 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-muted)]">
            Dados do agendamento
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label
                htmlFor="reservation-service"
                className="mb-1 block text-xs font-medium text-[var(--brand-muted)]"
              >
                Serviço
              </label>
              <select
                id="reservation-service"
                value={editingReservationService}
                onChange={(event) => setEditingReservationService(event.target.value)}
                disabled={savingReservationDraft}
                className={selectClass}
              >
                <option value="">Não informado</option>
                {serviceOptions.map((option) => (
                  <option key={option.id} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>

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

            <div className="col-span-2 grid grid-cols-2 gap-2">
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

            <button
              type="button"
              onClick={handleSaveReservationDraft}
              disabled={savingReservationDraft}
              className="col-span-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingReservationDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar agendamento
            </button>
          </div>
        </div>

      </div>
    </aside>
  );
}
