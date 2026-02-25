/**
 * Declarações de funções para a IA consultar/criar reservas (Gemini function calling).
 */

import type { FunctionDeclarationsTool } from "@google/generative-ai";
import { SchemaType } from "@google/generative-ai";

export const reservationTools: FunctionDeclarationsTool = {
  functionDeclarations: [
    {
      name: "check_availability",
      description:
        "Verifica se um horário está disponível para reserva. Use antes de criar a reserva.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          dateStr: {
            type: SchemaType.STRING,
            description: "Data no formato YYYY-MM-DD (ex: 2025-02-28)",
          },
          timeStr: {
            type: SchemaType.STRING,
            description: "Horário no formato HH:mm em 24h (ex: 14:30)",
          },
          durationMinutes: {
            type: SchemaType.INTEGER,
            description: "Duração em minutos (padrão 60)",
          },
        },
        required: ["dateStr", "timeStr"],
      },
    },
    {
      name: "create_reservation",
      description:
        "Cria uma reserva após confirmar com o cliente. Use somente após check_availability indicar disponibilidade e o cliente confirmar.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          dateStr: {
            type: SchemaType.STRING,
            description: "Data no formato YYYY-MM-DD",
          },
          timeStr: {
            type: SchemaType.STRING,
            description: "Horário no formato HH:mm em 24h",
          },
          durationMinutes: {
            type: SchemaType.INTEGER,
            description: "Duração em minutos (padrão 60)",
          },
          notes: {
            type: SchemaType.STRING,
            description: "Observações opcionais da reserva",
          },
        },
        required: ["dateStr", "timeStr"],
      },
    },
  ],
};
