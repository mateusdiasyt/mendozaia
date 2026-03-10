"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  createReservation,
  listAvailableReservationSlots,
} from "@/app/actions/reservations";

type ContactOption = {
  id: string;
  name: string | null;
  phone: string;
};

function todayAsInputDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function NewReservationModal({ contacts }: { contacts: ContactOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [dateStr, setDateStr] = useState(todayAsInputDate());
  const [duration, setDuration] = useState(60);
  const [timeStr, setTimeStr] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleKm, setVehicleKm] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [slotOptions, setSlotOptions] = useState<string[]>([]);
  const [slotMessage, setSlotMessage] = useState<string>("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const knownPhones = useMemo(
    () =>
      contacts
        .map((item) => item.phone?.trim())
        .filter((value): value is string => Boolean(value)),
    [contacts]
  );

  const knownNames = useMemo(
    () =>
      contacts
        .map((item) => item.name?.trim())
        .filter((value): value is string => Boolean(value)),
    [contacts]
  );

  useEffect(() => {
    if (!open || !dateStr) return;

    let active = true;
    async function loadSlots() {
      setLoadingSlots(true);
      setError(null);
      const result = await listAvailableReservationSlots(dateStr, duration);
      if (!active) return;

      if (result.error) {
        setSlotOptions([]);
        setSlotMessage(result.error);
        setTimeStr("");
      } else {
        setSlotOptions(result.slots);
        setSlotMessage(result.message);
        setTimeStr((prev) => {
          if (prev && result.slots.includes(prev)) return prev;
          return result.slots[0] ?? "";
        });
      }

      setLoadingSlots(false);
    }

    void loadSlots();
    return () => {
      active = false;
    };
  }, [open, dateStr, duration]);

  function resetForm() {
    setDateStr(todayAsInputDate());
    setDuration(60);
    setTimeStr("");
    setServiceName("");
    setVehicleModel("");
    setVehicleKm("");
    setVehicleYear("");
    setCustomerName("");
    setCustomerPhone("");
    setSlotOptions([]);
    setSlotMessage("");
    setError(null);
  }

  function closeModal() {
    if (isPending) return;
    setOpen(false);
  }

  function handleCreateReservation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!dateStr || !timeStr) {
      setError("Selecione data e horário disponíveis.");
      return;
    }

    const [year, month, day] = dateStr.split("-").map(Number);
    const [hour, min] = timeStr.split(":").map(Number);
    const startAt = new Date(year, month - 1, day, hour, min ?? 0, 0);

    const parsedYear = Number.parseInt(vehicleYear, 10);
    const parsedKm = Number.parseInt(vehicleKm.replace(/\D+/g, ""), 10);

    const notes = JSON.stringify({
      customerName: customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      vehicle: {
        modelo: vehicleModel.trim() || null,
        ano: Number.isFinite(parsedYear) ? parsedYear : null,
        km: Number.isFinite(parsedKm) ? parsedKm : vehicleKm.trim() || null,
      },
      serviceName: serviceName.trim() || null,
    });

    startTransition(async () => {
      const result = await createReservation({
        startAt,
        durationMinutes: duration,
        serviceName: serviceName.trim() || undefined,
        notes,
        source: "manual",
      });

      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }

      setOpen(false);
      resetForm();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-fit items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
      >
        <Plus className="h-5 w-5" />
        Nova reserva
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#6C6C94]/30 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#131047]">Nova reserva</h2>
                <p className="text-xs text-[#6C6C94]">
                  Preencha os dados principais para criar o agendamento.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateReservation} className="space-y-4 px-5 py-4">
              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    Data
                  </label>
                  <input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    Duração
                  </label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number.parseInt(e.target.value, 10))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  >
                    <option value={30}>30 min</option>
                    <option value={60}>60 min</option>
                    <option value={90}>90 min</option>
                    <option value={120}>120 min</option>
                  </select>
                </div>

                <div className="sm:col-span-1">
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    Horário
                  </label>
                  <select
                    value={timeStr}
                    onChange={(e) => setTimeStr(e.target.value)}
                    required
                    disabled={loadingSlots || slotOptions.length === 0}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    <option value="">
                      {loadingSlots ? "Carregando horários..." : "Selecione"}
                    </option>
                    {slotOptions.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="text-xs text-slate-500">{slotMessage}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    🔧 Sobre
                  </label>
                  <input
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="Ex.: Troca de óleo"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    🚗 Carro
                  </label>
                  <input
                    value={vehicleModel}
                    onChange={(e) => setVehicleModel(e.target.value)}
                    placeholder="Ex.: Onix"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    📏 KM
                  </label>
                  <input
                    value={vehicleKm}
                    onChange={(e) => setVehicleKm(e.target.value)}
                    placeholder="Ex.: 70000"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    🏷️ Ano
                  </label>
                  <input
                    value={vehicleYear}
                    onChange={(e) => setVehicleYear(e.target.value)}
                    placeholder="Ex.: 2022"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    🙋 Cliente
                  </label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    list="reservation-known-names"
                    placeholder="Nome do cliente"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#131047]">
                    📱 Contato
                  </label>
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    list="reservation-known-phones"
                    placeholder="Número do cliente"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[var(--brand-primary)] focus:outline-none"
                  />
                </div>
              </div>

              <datalist id="reservation-known-phones">
                {knownPhones.map((phone) => (
                  <option key={phone} value={phone} />
                ))}
              </datalist>
              <datalist id="reservation-known-names">
                {knownNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending || loadingSlots || !timeStr}
                  className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? "Salvando..." : "Criar reserva"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
