/** Opções de duração para desativar IA manualmente (usado no client) */
export const AI_DISABLE_DURATIONS = [
  { hours: 1, label: "1 hora" },
  { hours: 3, label: "3 horas" },
  { hours: 6, label: "6 horas" },
  { hours: 12, label: "12 horas" },
  { hours: 24, label: "24 horas" },
  { hours: 87600, label: "Para sempre" }, // 10 anos = efetivamente permanente
] as const;
