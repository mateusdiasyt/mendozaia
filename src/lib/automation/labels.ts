import type { TriggerType, ConditionType, ActionType } from "./types";
import {
  TRIGGER_TYPES,
  CONDITION_TYPES,
  ACTION_TYPES,
} from "./types";

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  [TRIGGER_TYPES.MESSAGE_RECEIVED]: "Mensagem recebida",
  [TRIGGER_TYPES.NO_REPLY_TIMEOUT]: "Sem resposta há X minutos",
};

export const CONDITION_LABELS: Record<ConditionType, string> = {
  [CONDITION_TYPES.NONE]: "Sempre",
  [CONDITION_TYPES.KEYWORD_CONTAINS]: "Contém palavra-chave",
  [CONDITION_TYPES.OUTSIDE_BUSINESS_HOURS]: "Fora do horário comercial",
  [CONDITION_TYPES.MINUTES_WITHOUT_REPLY]: "X minutos sem resposta",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  [ACTION_TYPES.REPLY]: "Responder com mensagem",
  [ACTION_TYPES.AI_REPLY]: "Responder com IA (Gemini)",
  [ACTION_TYPES.ADD_TAG]: "Aplicar etiqueta",
  [ACTION_TYPES.ASSIGN_TO_HUMAN]: "Transferir para humano",
};
