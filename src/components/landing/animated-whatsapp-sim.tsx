"use client";

import { useEffect, useMemo, useState } from "react";

type SimMessage = {
  id: string;
  sender: "client" | "bot";
  text: string;
  delayMs: number;
};

const SCRIPT: SimMessage[] = [
  {
    id: "m1",
    sender: "client",
    text: "Oi! Meu carro esta fazendo um barulho estranho.",
    delayMs: 500,
  },
  {
    id: "m2",
    sender: "bot",
    text: "Entendi! Vou te ajudar. Qual e o modelo do veiculo?",
    delayMs: 1200,
  },
  {
    id: "m3",
    sender: "client",
    text: "Onix 2022",
    delayMs: 900,
  },
  {
    id: "m4",
    sender: "bot",
    text: "Perfeito, Onix 2022 registrado. Se souber, me manda a km.",
    delayMs: 1300,
  },
  {
    id: "m5",
    sender: "client",
    text: "Nao sei a km agora",
    delayMs: 900,
  },
  {
    id: "m6",
    sender: "bot",
    text: "Sem problemas. Vou te encaminhar para um mecanico tecnico agora.",
    delayMs: 1400,
  },
];

export function AnimatedWhatsappSim() {
  const [visibleCount, setVisibleCount] = useState(0);

  const visibleMessages = useMemo(
    () => SCRIPT.slice(0, visibleCount),
    [visibleCount]
  );

  const nextMessage = SCRIPT[visibleCount];
  const showTyping = !!nextMessage && nextMessage.sender === "bot";

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (visibleCount >= SCRIPT.length) {
      timeout = setTimeout(() => setVisibleCount(0), 2200);
      return () => timeout && clearTimeout(timeout);
    }

    const delay = SCRIPT[visibleCount]?.delayMs ?? 900;
    timeout = setTimeout(() => {
      setVisibleCount((prev) => prev + 1);
    }, delay);

    return () => timeout && clearTimeout(timeout);
  }, [visibleCount]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-[#efeae2] p-4 shadow-sm">
      <div className="rounded-xl border border-slate-200 bg-[#f0f2f5] px-3 py-2 text-xs font-semibold text-slate-600">
        Simulacao de conversa (Oficina)
      </div>
      <div className="mt-3 space-y-2">
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
