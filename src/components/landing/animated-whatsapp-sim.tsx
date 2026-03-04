"use client";

import { useEffect, useMemo, useState } from "react";

type SimMessage = {
  id: string;
  sender: "client" | "bot";
  text: string;
  delayMs: number;
};

type SimScenario = {
  id: string;
  title: string;
  messages: SimMessage[];
};

const SCENARIOS: SimScenario[] = [
  {
    id: "oficina-tecnico",
    title: "Simulacao de conversa (Oficina - Caso tecnico)",
    messages: [
      {
        id: "a1",
        sender: "client",
        text: "Oi! Meu carro esta com cheiro de queimado e perdeu potencia.",
        delayMs: 1200,
      },
      {
        id: "a2",
        sender: "bot",
        text: "Entendi. Isso parece um caso tecnico. Qual e o modelo e ano do veiculo?",
        delayMs: 2500,
      },
      {
        id: "a3",
        sender: "client",
        text: "Peugeot 206 2010",
        delayMs: 1300,
      },
      {
        id: "a4",
        sender: "bot",
        text: "Perfeito, vou encaminhar agora para um mecanico tecnico.",
        delayMs: 2600,
      },
    ],
  },
  {
    id: "oficina-oleo",
    title: "Simulacao de conversa (Oficina - Orcamento)",
    messages: [
      {
        id: "b1",
        sender: "client",
        text: "Quero trocar o oleo do meu carro.",
        delayMs: 1100,
      },
      {
        id: "b2",
        sender: "bot",
        text: "Claro! Me passa modelo, ano e km para eu te orientar melhor.",
        delayMs: 2300,
      },
      {
        id: "b3",
        sender: "client",
        text: "Onix 2022 com 78 mil km",
        delayMs: 1200,
      },
      {
        id: "b4",
        sender: "bot",
        text: "Perfeito. Vou buscar a opcao ideal de oleo para seu veiculo.",
        delayMs: 2400,
      },
    ],
  },
  {
    id: "restaurante-reserva",
    title: "Simulacao de conversa (Restaurante - Reserva)",
    messages: [
      {
        id: "c1",
        sender: "client",
        text: "Oi, queria reservar uma mesa para hoje.",
        delayMs: 1200,
      },
      {
        id: "c2",
        sender: "bot",
        text: "Perfeito! Para quantas pessoas e qual horario voce prefere?",
        delayMs: 2500,
      },
      {
        id: "c3",
        sender: "client",
        text: "4 pessoas, as 20h",
        delayMs: 1200,
      },
      {
        id: "c4",
        sender: "bot",
        text: "Reserva confirmada para 4 pessoas, hoje as 20h. Te espero!",
        delayMs: 2600,
      },
    ],
  },
];

export function AnimatedWhatsappSim() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0);
  const currentScenario = SCENARIOS[scenarioIdx] ?? SCENARIOS[0];
  const messages = currentScenario.messages;

  const visibleMessages = useMemo(
    () => messages.slice(0, visibleCount),
    [messages, visibleCount]
  );

  const nextMessage = messages[visibleCount];
  const showTyping = !!nextMessage && nextMessage.sender === "bot";

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (visibleCount >= messages.length) {
      timeout = setTimeout(() => {
        setVisibleCount(0);
        setScenarioIdx((prev) => (prev + 1) % SCENARIOS.length);
      }, 3200);
      return () => timeout && clearTimeout(timeout);
    }

    const delay = messages[visibleCount]?.delayMs ?? 1400;
    timeout = setTimeout(() => {
      setVisibleCount((prev) => prev + 1);
    }, delay);

    return () => timeout && clearTimeout(timeout);
  }, [messages, visibleCount]);

  return (
    <div className="h-[360px] rounded-2xl border border-slate-200 bg-[#efeae2] p-4 shadow-sm">
      <div className="rounded-xl border border-slate-200 bg-[#f0f2f5] px-3 py-2 text-xs font-semibold text-slate-600">
        {currentScenario.title}
      </div>
      <div className="mt-3 h-[292px] space-y-2 overflow-y-hidden">
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
  );
}
