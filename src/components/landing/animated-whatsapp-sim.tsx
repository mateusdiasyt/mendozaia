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

const SCRIPT: SimMessage[] = [
  {
    id: "s1",
    sender: "client",
    text: "Oi! Quero agendar uma revisão do meu carro.",
    delayMs: 1200,
    statePatch: {
      stageLabel: "Intenção detectada: agendamento/revisão",
    },
  },
  {
    id: "s2",
    sender: "bot",
    text: "Perfeito! Para começar, qual o seu nome?",
    delayMs: 2200,
    statePatch: {
      stageLabel: "Coletando nome do contato",
    },
  },
  {
    id: "s3",
    sender: "client",
    text: "Mateus.",
    delayMs: 1200,
    statePatch: {
      contactName: "Mateus",
      stageLabel: "Nome validado",
    },
  },
  {
    id: "s4",
    sender: "bot",
    text: "Prazer, Mateus. Qual é o modelo do seu veículo?",
    delayMs: 2200,
    statePatch: {
      stageLabel: "Coletando modelo do veículo",
    },
  },
  {
    id: "s5",
    sender: "client",
    text: "Onix.",
    delayMs: 1100,
    statePatch: {
      carModel: "Onix",
      stageLabel: "Modelo validado",
    },
  },
  {
    id: "s6",
    sender: "bot",
    text: "Show. Qual é o ano do veículo?",
    delayMs: 2000,
    statePatch: {
      stageLabel: "Coletando ano do veículo",
    },
  },
  {
    id: "s7",
    sender: "client",
    text: "2022.",
    delayMs: 1100,
    statePatch: {
      carYear: "2022",
      stageLabel: "Ano validado",
    },
  },
  {
    id: "s8",
    sender: "bot",
    text: "Perfeito. Se souber, me informa também a quilometragem atual.",
    delayMs: 2300,
    statePatch: {
      stageLabel: "Coletando km do veículo",
    },
  },
  {
    id: "s9",
    sender: "client",
    text: "78 mil km.",
    delayMs: 1100,
    statePatch: {
      carKm: "78.000",
      stageLabel: "Perfil completo, pronto para agendamento",
    },
  },
  {
    id: "s10",
    sender: "bot",
    text: "Dados registrados. Qual dia você prefere para a revisão?",
    delayMs: 2200,
    statePatch: {
      stageLabel: "Solicitando data para agendamento",
    },
  },
  {
    id: "s11",
    sender: "client",
    text: "Quinta-feira.",
    delayMs: 1000,
    statePatch: {
      stageLabel: "Buscando disponibilidade da agenda",
    },
  },
  {
    id: "s12",
    sender: "bot",
    text: "Perfeito. Tenho 10:00, 14:00 e 16:00. Qual horário?",
    delayMs: 2300,
    statePatch: {
      stageLabel: "Horários sugeridos ao cliente",
    },
  },
  {
    id: "s13",
    sender: "client",
    text: "14:00",
    delayMs: 1100,
    statePatch: {
      stageLabel: "Horário escolhido, aguardando confirmação",
    },
  },
  {
    id: "s14",
    sender: "bot",
    text: "Confirmando: revisão do Onix 2022 na quinta às 14:00. Posso confirmar?",
    delayMs: 2300,
    statePatch: {
      stageLabel: "Confirmação final de reserva",
    },
  },
  {
    id: "s15",
    sender: "client",
    text: "Pode confirmar.",
    delayMs: 1100,
    statePatch: {
      stageLabel: "Autorização recebida",
    },
  },
  {
    id: "s16",
    sender: "bot",
    text: "Reserva confirmada. Te espero na quinta às 14:00.",
    delayMs: 2200,
    statePatch: {
      stageLabel: "Reserva concluída com sucesso",
    },
  },
];

export function AnimatedWhatsappSim() {
  const [visibleCount, setVisibleCount] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="h-[360px] rounded-2xl border border-slate-200 bg-[#efeae2] p-4 shadow-sm">
        <div className="rounded-xl border border-slate-200 bg-[#f0f2f5] px-3 py-2 text-xs font-semibold text-slate-600">
          Simulação de conversa (Agendamento completo)
        </div>
        <div
          ref={scrollerRef}
          className="mt-3 h-[292px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pointer-events-none"
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

      <div className="h-[360px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          Estado da IA (tempo real)
        </div>
        <div className="mt-3 h-[292px] space-y-3 overflow-hidden">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Veículo do contato
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Nome: <span className="font-medium text-slate-900">{runtimeState.contactName}</span>
            </p>
            <p className="text-sm text-slate-700">
              Modelo: <span className="font-medium text-slate-900">{runtimeState.carModel}</span>
            </p>
            <p className="text-sm text-slate-700">
              Ano: <span className="font-medium text-slate-900">{runtimeState.carYear}</span>
            </p>
            <p className="text-sm text-slate-700">
              KM: <span className="font-medium text-slate-900">{runtimeState.carKm}</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Atendimento humano
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">{runtimeState.waitingHuman}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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
            ].join(" ")}
          >
            IA: <span className="font-semibold">{runtimeState.aiStatus}</span>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
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
        </div>
      </div>
    </div>
  );
}
