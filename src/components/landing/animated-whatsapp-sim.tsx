"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SimMessage = {
  id: string;
  sender: "client" | "bot";
  text: string;
  delayMs: number;
  statePatch?: Partial<SimRuntimeState>;
};

type SimRuntimeState = {
  contactName: string;
  carModel: string;
  carYear: string;
  carKm: string;
  waitingHuman: "Sim" | "Não";
  carInShop: "Sim" | "Não";
  aiStatus: "Ativa" | "Aguardando humano";
  stageLabel: string;
};

const INITIAL_STATE: SimRuntimeState = {
  contactName: "Não informado",
  carModel: "Não informado",
  carYear: "Não informado",
  carKm: "Não informado",
  waitingHuman: "Não",
  carInShop: "Não",
  aiStatus: "Ativa",
  stageLabel: "Aguardando primeira mensagem",
};

function playTickSound(
  audioContextRef: { current: AudioContext | null },
  soundEnabled: boolean
) {
  if (!soundEnabled || typeof window === "undefined") return;
  try {
    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext();
    }
    const audioCtx = audioContextRef.current;
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.value = 920;
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.05, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.16);
  } catch {
    // Ignora falhas de áudio por política do navegador.
  }
}

const SCRIPT: SimMessage[] = [
  {
    id: "s1",
    sender: "client",
    text: "Oi! Preciso de ajuda com meu carro.",
    delayMs: 1200,
    statePatch: {
      stageLabel: "Primeiro contato recebido no WhatsApp",
    },
  },
  {
    id: "s2",
    sender: "bot",
    text: "Olá, tudo bem? Me informa, por favor, o modelo do seu carro.",
    delayMs: 2200,
    statePatch: {
      stageLabel: "Triagem: aguardando modelo do veículo",
    },
  },
  {
    id: "s3",
    sender: "client",
    text: "Onix 2022, 78 mil km.",
    delayMs: 1200,
    statePatch: {
      carModel: "Onix",
      carYear: "2022",
      carKm: "78.000",
      stageLabel: "Veículo validado pela política da oficina",
    },
  },
  {
    id: "s4",
    sender: "bot",
    text: "Perfeito, já vou encaminhar você para o mecânico técnico.",
    delayMs: 2200,
    statePatch: {
      waitingHuman: "Sim",
      aiStatus: "Aguardando humano",
      stageLabel: "Mecânico técnico assumindo o atendimento",
    },
  },
];

type AnimatedWhatsappSimProps = {
  variant?: "compact" | "full";
};

export function AnimatedWhatsappSim({
  variant = "compact",
}: AnimatedWhatsappSimProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [highlightedKeys, setHighlightedKeys] = useState<string[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const visibleMessages = useMemo(
    () => SCRIPT.slice(0, visibleCount),
    [visibleCount]
  );
  const runtimeState = useMemo(() => {
    return visibleMessages.reduce<SimRuntimeState>(
      (acc, message) => ({
        ...acc,
        ...(message.statePatch ?? {}),
      }),
      INITIAL_STATE
    );
  }, [visibleMessages]);

  const nextMessage = SCRIPT[visibleCount];
  const showTyping = !!nextMessage && nextMessage.sender === "bot";
  const isFull = variant === "full";
  const panelHeightClass = isFull ? "h-[520px]" : "h-[360px]";
  const contentHeightClass = isFull ? "h-[452px]" : "h-[292px]";

  const isHighlighted = (key: keyof SimRuntimeState) =>
    highlightedKeys.includes(key);

  useEffect(() => {
    const enableSound = () => {
      setSoundEnabled(true);
      window.removeEventListener("pointerdown", enableSound);
      window.removeEventListener("keydown", enableSound);
    };

    window.addEventListener("pointerdown", enableSound);
    window.addEventListener("keydown", enableSound);
    return () => {
      window.removeEventListener("pointerdown", enableSound);
      window.removeEventListener("keydown", enableSound);
    };
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (visibleCount >= SCRIPT.length) {
      timeout = setTimeout(() => {
        setVisibleCount(0);
        if (scrollerRef.current) {
          scrollerRef.current.scrollTo({ top: 0, behavior: "auto" });
        }
      }, 3600);
      return () => timeout && clearTimeout(timeout);
    }

    const delay = SCRIPT[visibleCount]?.delayMs ?? 1500;
    timeout = setTimeout(() => {
      setVisibleCount((prev) => prev + 1);
    }, delay);

    return () => timeout && clearTimeout(timeout);
  }, [visibleCount]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleMessages.length, showTyping]);

  useEffect(() => {
    const lastMessage = visibleMessages[visibleMessages.length - 1];
    const patchKeys = Object.keys(lastMessage?.statePatch ?? {}) as Array<
      keyof SimRuntimeState
    >;
    if (patchKeys.length === 0) return;

    let clearHighlightTimeout: ReturnType<typeof setTimeout> | undefined;
    const startHighlightTimeout = setTimeout(() => {
      setHighlightedKeys(patchKeys);
      playTickSound(audioContextRef, soundEnabled);
      clearHighlightTimeout = setTimeout(() => setHighlightedKeys([]), 850);
    }, 0);

    return () => {
      clearTimeout(startHighlightTimeout);
      if (clearHighlightTimeout) clearTimeout(clearHighlightTimeout);
    };
  }, [visibleMessages, soundEnabled]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div
        className={`${panelHeightClass} rounded-2xl border border-slate-200 bg-[#efeae2] p-4 shadow-sm`}
      >
        <div className="rounded-xl border border-slate-200 bg-[#f0f2f5] px-3 py-2 text-xs font-semibold text-slate-600">
          Simulação de conversa (sem ação real)
        </div>
        <div
          ref={scrollerRef}
          className={`${contentHeightClass} mt-3 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pointer-events-none`}
        >
          {visibleMessages.map((message) => {
            const isBot = message.sender === "bot";
            return (
              <div
                key={message.id}
                className={[
                  "max-w-[82%] rounded-xl px-3 py-2 text-sm shadow-sm transition-all duration-300",
                  isBot
                    ? "ml-auto rounded-br-sm bg-[#d9fdd3] text-slate-800"
                    : "rounded-bl-sm bg-white text-slate-700",
                ].join(" ")}
              >
                {message.text}
              </div>
            );
          })}

          {showTyping && (
            <div className="max-w-28 rounded-xl rounded-bl-sm bg-white px-3 py-2 shadow-sm">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                <span
                  className="h-2 w-2 animate-pulse rounded-full bg-slate-400"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="h-2 w-2 animate-pulse rounded-full bg-slate-400"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`${panelHeightClass} rounded-2xl border border-slate-200 bg-white p-4 shadow-sm`}>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          Estado da IA (tempo real)
        </div>
        <div
          className={`${contentHeightClass} mt-3 space-y-3 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`}
        >
          <div
            className={[
              "rounded-xl border border-slate-200 bg-slate-50 p-3 transition-all duration-300",
              (isHighlighted("contactName") ||
                isHighlighted("carModel") ||
                isHighlighted("carYear") ||
                isHighlighted("carKm")) &&
              "border-indigo-300 bg-indigo-50/80 shadow-sm animate-pulse",
            ].join(" ")}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Veículo do contato
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Nome:{" "}
              <span
                className={[
                  "font-medium text-slate-900 transition-all duration-300",
                  isHighlighted("contactName") && "rounded bg-indigo-100 px-1",
                ].join(" ")}
              >
                {runtimeState.contactName}
              </span>
            </p>
            <p className="text-sm text-slate-700">
              Modelo:{" "}
              <span
                className={[
                  "font-medium text-slate-900 transition-all duration-300",
                  isHighlighted("carModel") && "rounded bg-indigo-100 px-1",
                ].join(" ")}
              >
                {runtimeState.carModel}
              </span>
            </p>
            <p className="text-sm text-slate-700">
              Ano:{" "}
              <span
                className={[
                  "font-medium text-slate-900 transition-all duration-300",
                  isHighlighted("carYear") && "rounded bg-indigo-100 px-1",
                ].join(" ")}
              >
                {runtimeState.carYear}
              </span>
            </p>
            <p className="text-sm text-slate-700">
              KM:{" "}
              <span
                className={[
                  "font-medium text-slate-900 transition-all duration-300",
                  isHighlighted("carKm") && "rounded bg-indigo-100 px-1",
                ].join(" ")}
              >
                {runtimeState.carKm}
              </span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div
              className={[
                "rounded-xl border border-slate-200 bg-slate-50 p-3 transition-all duration-300",
                isHighlighted("waitingHuman") &&
                  "border-indigo-300 bg-indigo-50/80 shadow-sm animate-pulse",
              ].join(" ")}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Atendimento humano
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">{runtimeState.waitingHuman}</p>
            </div>
            <div
              className={[
                "rounded-xl border border-slate-200 bg-slate-50 p-3 transition-all duration-300",
                isHighlighted("carInShop") &&
                  "border-indigo-300 bg-indigo-50/80 shadow-sm animate-pulse",
              ].join(" ")}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Carro na mecânica
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">{runtimeState.carInShop}</p>
            </div>
          </div>

          <div
            className={[
              "rounded-xl border p-3 text-sm",
              runtimeState.aiStatus === "Ativa"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800",
              isHighlighted("aiStatus") && "animate-pulse",
            ].join(" ")}
          >
            IA: <span className="font-semibold">{runtimeState.aiStatus}</span>
          </div>

          <div
            className={[
              "rounded-xl border border-indigo-200 bg-indigo-50 p-3 transition-all duration-300",
              isHighlighted("stageLabel") && "ring-2 ring-indigo-200 animate-pulse",
            ].join(" ")}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
              Etapa atual do fluxo
            </p>
            <p className="mt-1 text-sm font-medium text-indigo-900">{runtimeState.stageLabel}</p>
          </div>
          {showTyping && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              A IA está processando a próxima resposta...
            </div>
          )}
          {!soundEnabled && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              Toque ou clique na página para ativar o som da simulação.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
