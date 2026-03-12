"use client";

import { useEffect, useState } from "react";
import { Bot, BotOff, ChevronDown, Loader2 } from "lucide-react";
import {
  setConversationAIDisabled,
  setConversationAIEnabled,
  setConversationCarInShop,
  setConversationHumanWaiting,
  setConversationVehicleOil,
  updateConversationVehicleData,
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
  const [updatingVehicle, setUpdatingVehicle] = useState(false);
  const [editingVehicleField, setEditingVehicleField] = useState<
    "model" | "year" | "km" | null
  >(null);
  const [editingVehicleModel, setEditingVehicleModel] = useState(vehicleModel ?? "");
  const [editingVehicleYear, setEditingVehicleYear] = useState(vehicleYear ?? "");
  const [editingVehicleKm, setEditingVehicleKm] = useState(vehicleKm ?? "");
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
  const [showDisableOptions, setShowDisableOptions] = useState(false);

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
    setEditingVehicleModel(vehicleModel ?? "");
  }, [vehicleModel]);

  useEffect(() => {
    setEditingVehicleYear(vehicleYear ?? "");
  }, [vehicleYear]);

  useEffect(() => {
    setEditingVehicleKm(vehicleKm ?? "");
  }, [vehicleKm]);

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
  const disableOptions: Array<{ label: string; hours: number }> = [
    { label: "30 min", hours: 0.5 },
    { label: "1h", hours: 1 },
    { label: "3h", hours: 3 },
    { label: "12h", hours: 12 },
    { label: "24h", hours: 24 },
    { label: "Manual", hours: 87600 },
  ];

  function formatPauseInfo(date: Date | null): string {
    if (!date || Number.isNaN(date.getTime())) {
      return "até reativação manual";
    }
    const diffMs = date.getTime() - Date.now();
    if (diffMs <= 0) {
      return "expirando agora";
    }
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (diffMs > oneYearMs) {
      return "até reativação manual";
    }
    if (diffMs < 60 * 60 * 1000) {
      const mins = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
      return `por ~${mins} min`;
    }
    if (diffMs < 24 * 60 * 60 * 1000) {
      const hours = Math.max(1, Math.ceil(diffMs / (60 * 60 * 1000)));
      return `por ~${hours}h`;
    }
    return `até ${new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)}`;
  }

  const disabledDetail = isDisabledByColumn
    ? carInWorkshop
      ? "Pausada enquanto o carro está na mecânica"
      : isWaitingHuman
        ? "Pausada aguardando atendimento humano"
        : "Pausada na coluna de atendimento humano"
    : isDisabledByTime
      ? `Reativação automática ${formatPauseInfo(until)}`
      : "Pausada neste contato";

  async function handleEnableAI() {
    setLoadingToggleAI(true);
    try {
      await setConversationAIEnabled(conversationId);
      setUntil(null);
      setShowDisableOptions(false);
      router.refresh();
    } catch {
      // noop
    } finally {
      setLoadingToggleAI(false);
    }
  }

  async function handleDisableFor(hours: number) {
    setLoadingToggleAI(true);
    try {
      const result = await setConversationAIDisabled(conversationId, hours);
      setUntil(result.aiDisabledUntil ? new Date(result.aiDisabledUntil) : null);
      setShowDisableOptions(false);
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

  async function handleSaveVehicleFields() {
    setUpdatingVehicle(true);
    try {
      await updateConversationVehicleData(conversationId, {
        model: editingVehicleModel || null,
        year: editingVehicleYear || null,
        km: editingVehicleKm || null,
      });
      setEditingVehicleField(null);
      router.refresh();
    } catch {
      // noop
    } finally {
      setUpdatingVehicle(false);
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
                {isDisabled ? disabledDetail : "Respondendo automaticamente"}
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
            onClick={() => {
              if (isDisabled) {
                void handleEnableAI();
                return;
              }
              setShowDisableOptions((value) => !value);
            }}
            disabled={loadingToggleAI}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand-muted)]/30 bg-white px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingToggleAI ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isDisabled ? "Ativar IA" : "Desativar IA"}
            {!isDisabled ? (
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  showDisableOptions ? "rotate-180" : ""
                }`}
              />
            ) : null}
          </button>

          {!isDisabled && showDisableOptions ? (
            <div className="mt-2 -mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex w-max items-center gap-1.5">
                {disableOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => {
                      void handleDisableFor(option.hours);
                    }}
                    disabled={loadingToggleAI}
                    className="whitespace-nowrap rounded-full border border-[var(--brand-muted)]/30 bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-semibold leading-none text-[var(--brand-deep)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
                  {editingVehicleField === "model" ? (
                    <input
                      autoFocus
                      value={editingVehicleModel}
                      disabled={updatingVehicle}
                      onChange={(event) => setEditingVehicleModel(event.target.value)}
                      onBlur={() => void handleSaveVehicleFields()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSaveVehicleFields();
                        }
                        if (event.key === "Escape") {
                          setEditingVehicleModel(vehicleModel ?? "");
                          setEditingVehicleField(null);
                        }
                      }}
                      className="mt-0.5 h-7 w-full rounded border border-[var(--brand-muted)]/30 bg-white px-2 text-xs"
                    />
                  ) : (
                    <p
                      className="cursor-text font-medium"
                      onDoubleClick={() => setEditingVehicleField("model")}
                      title="Duplo clique para editar"
                    >
                      {vehicleModel || "-"}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-[var(--brand-muted)]">Ano</p>
                  {editingVehicleField === "year" ? (
                    <input
                      autoFocus
                      value={editingVehicleYear}
                      disabled={updatingVehicle}
                      onChange={(event) => setEditingVehicleYear(event.target.value)}
                      onBlur={() => void handleSaveVehicleFields()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSaveVehicleFields();
                        }
                        if (event.key === "Escape") {
                          setEditingVehicleYear(vehicleYear ?? "");
                          setEditingVehicleField(null);
                        }
                      }}
                      className="mt-0.5 h-7 w-full rounded border border-[var(--brand-muted)]/30 bg-white px-2 text-xs"
                    />
                  ) : (
                    <p
                      className="cursor-text font-medium"
                      onDoubleClick={() => setEditingVehicleField("year")}
                      title="Duplo clique para editar"
                    >
                      {vehicleYear || "-"}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-[var(--brand-muted)]">KM</p>
                  {editingVehicleField === "km" ? (
                    <input
                      autoFocus
                      value={editingVehicleKm}
                      disabled={updatingVehicle}
                      onChange={(event) => setEditingVehicleKm(event.target.value)}
                      onBlur={() => void handleSaveVehicleFields()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSaveVehicleFields();
                        }
                        if (event.key === "Escape") {
                          setEditingVehicleKm(vehicleKm ?? "");
                          setEditingVehicleField(null);
                        }
                      }}
                      className="mt-0.5 h-7 w-full rounded border border-[var(--brand-muted)]/30 bg-white px-2 text-xs"
                    />
                  ) : (
                    <p
                      className="cursor-text font-medium"
                      onDoubleClick={() => setEditingVehicleField("km")}
                      title="Duplo clique para editar"
                    >
                      {vehicleKm || "-"}
                    </p>
                  )}
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
