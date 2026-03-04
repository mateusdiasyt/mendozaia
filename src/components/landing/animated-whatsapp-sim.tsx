"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SimMessage = {
  id: string;
  sender: "client" | "bot";
  text: string;
  delayMs: number;
};

const SCRIPT: SimMessage[] = [
  {
    id: "s1",
    sender: "client",
    text: "Oi! Quero agendar uma revisão do meu carro.",
    delayMs: 1200,
  },
  {
    id: "s2",
    sender: "bot",
    text: "Perfeito! Me informa seu nome, modelo, ano e km do veículo.",
    delayMs: 2300,
  },
  {
    id: "s3",
    sender: "client",
    text: "Mateus, Onix 2022, 78 mil km.",
    delayMs: 1300,
  },
  {
    id: "s4",
    sender: "bot",
    text: "Show, dados registrados. Qual dia você prefere?",
    delayMs: 2100,
  },
  {
    id: "s5",
    sender: "client",
    text: "Quinta-feira.",
    delayMs: 1100,
  },
  {
    id: "s6",
    sender: "bot",
    text: "Perfeito. Tenho 10:00, 14:00 e 16:00. Qual horário?",
    delayMs: 2200,
  },
  {
    id: "s7",
    sender: "client",
    text: "14:00",
    delayMs: 1000,
  },
  {
    id: "s8",
    sender: "bot",
    text: "Confirmando: revisão do Onix 2022 na quinta às 14:00. Posso confirmar?",
    delayMs: 2300,
  },
  {
    id: "s9",
    sender: "client",
    text: "Pode confirmar.",
    delayMs: 1100,
  },
  {
    id: "s10",
    sender: "bot",
    text: "Reserva confirmada. Te espero na quinta às 14:00.",
    delayMs: 2200,
  },
];

export function AnimatedWhatsappSim() {
  const [visibleCount, setVisibleCount] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const visibleMessages = useMemo(
    () => SCRIPT.slice(0, visibleCount),
    [visibleCount]
  );

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
    <div className="h-[360px] rounded-2xl border border-slate-200 bg-[#efeae2] p-4 shadow-sm">
      <div className="rounded-xl border border-slate-200 bg-[#f0f2f5] px-3 py-2 text-xs font-semibold text-slate-600">
        Simulacao de conversa (Agendamento completo)
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
  );
}
