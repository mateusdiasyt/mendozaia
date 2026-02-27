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
        "Verifica se há disponibilidade em um horário. Use SEMPRE que o cliente mencionar data e horário (ex: 'amanhã às 14h', 'dia 15 às 10:30', 'próxima segunda 9h'). Converta linguagem natural para YYYY-MM-DD e HH:mm.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          dateStr: {
            type: SchemaType.STRING,
            description: "Data em YYYY-MM-DD. Ex: hoje=hoje, amanhã=amanhã+1dia, 'dia 15'=dia 15 do mês atual",
          },
          timeStr: {
            type: SchemaType.STRING,
            description: "Horário em HH:mm 24h. Ex: '14h'=14:00, '9h30'=09:30, '3 da tarde'=15:00",
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
        "Confirma e cria a reserva. Use APÓS check_availability retornar available=true E o cliente confirmar ('sim', 'pode ser', 'confirmo', 'quero').",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          dateStr: {
            type: SchemaType.STRING,
            description: "Data em YYYY-MM-DD",
          },
          timeStr: {
            type: SchemaType.STRING,
            description: "Horário em HH:mm 24h",
          },
          durationMinutes: {
            type: SchemaType.INTEGER,
            description: "Duração em minutos (padrão 60)",
          },
          notes: {
            type: SchemaType.STRING,
            description: "Observações (ex: dados do veículo, serviço desejado)",
          },
        },
        required: ["dateStr", "timeStr"],
      },
    },
  ],
};
