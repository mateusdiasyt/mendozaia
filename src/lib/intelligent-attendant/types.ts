export type Intent =
  | "agendamento_servico"
  | "consulta_disponibilidade"
  | "orcamento"
  | "duvidas_gerais"
  | "saudacao"
  | "localizacao_horario";

export type ConversationStep =
  | "aguardando_intencao"
  | "coletando_dados"
  | "aguardando_confirmacao"
  | "agendado"
  | "atendimento_humano";

export interface ConversationState {
  phone: string;
  intent: Intent | null;
  nome: string | null;
  veiculo_modelo: string | null;
  veiculo_ano: string | null;
  quilometragem: string | null;
  data_desejada: string | null;
  periodo_desejado: "manha" | "tarde" | null;
  tipo_servico: string | null;
  etapa: ConversationStep;
  lastInteractionAt: string;
  greetedOnce: boolean;
  lastBotReply: string | null;
  lastBotReplyAt: string | null;
  recentMessages: Array<{
    role: "user" | "assistant";
    text: string;
    at: string;
  }>;
}

export interface ExtractedEntities {
  nome?: string;
  veiculo_modelo?: string;
  veiculo_ano?: string;
  quilometragem?: string;
  data_desejada?: string;
  periodo_desejado?: "manha" | "tarde";
  tipo_servico?: string;
}

export interface NlpResult {
  intent: Intent | null;
  entities: ExtractedEntities;
  isAffirmative: boolean;
  isNegative: boolean;
}

export interface HandleIncomingResult {
  reply: string;
  state: ConversationState;
  action:
    | "none"
    | "check_availability"
    | "schedule"
    | "handoff_human";
}

export interface ConversationStateStore {
  getByPhone(phone: string): Promise<ConversationState | null>;
  save(state: ConversationState): Promise<void>;
}

export interface HandleIncomingDeps {
  store: ConversationStateStore;
  now?: () => Date;
  availabilityChecker?: (input: {
    phone: string;
    dateText: string;
    serviceType: string | null;
  }) => Promise<{ available: boolean; note?: string }>;
}
