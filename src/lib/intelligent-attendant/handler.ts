import { analyzeMessage, normalizeText } from "./nlp";
import type {
  ConversationState,
  ConversationStep,
  HandleIncomingDeps,
  HandleIncomingResult,
  Intent,
} from "./types";

const STITCH_WINDOW_MS = 20 * 1000;
const MAX_STITCH_MESSAGES = 4;
const LONG_INACTIVITY_MS = 6 * 60 * 60 * 1000;

function createInitialState(phone: string, now: Date): ConversationState {
  return {
    phone,
    intent: null,
    nome: null,
    veiculo_modelo: null,
    veiculo_ano: null,
    quilometragem: null,
    data_desejada: null,
    periodo_desejado: null,
    tipo_servico: null,
    etapa: "aguardando_intencao",
    lastInteractionAt: now.toISOString(),
    greetedOnce: false,
    lastBotReply: null,
    lastBotReplyAt: null,
    recentMessages: [],
  };
}

function addRecentMessage(
  state: ConversationState,
  role: "user" | "assistant",
  text: string,
  now: Date
): void {
  state.recentMessages.push({ role, text, at: now.toISOString() });
  if (state.recentMessages.length > 20) {
    state.recentMessages = state.recentMessages.slice(-20);
  }
}

function stitchUserMessages(state: ConversationState, now: Date): string {
  const nowTs = now.getTime();
  const userRecent = [...state.recentMessages]
    .reverse()
    .filter((m) => m.role === "user")
    .filter((m, idx) => {
      if (idx >= MAX_STITCH_MESSAGES) return false;
      return nowTs - new Date(m.at).getTime() <= STITCH_WINDOW_MS;
    })
    .reverse()
    .map((m) => m.text.trim())
    .filter(Boolean);

  return userRecent.join(" ").replace(/\s+/g, " ").trim();
}

function hasLongInactivity(state: ConversationState, now: Date): boolean {
  const last = new Date(state.lastInteractionAt).getTime();
  return now.getTime() - last > LONG_INACTIVITY_MS;
}

function pickIntent(current: Intent | null, incoming: Intent | null): Intent | null {
  if (!incoming) return current;
  if (!current) return incoming;

  if (current === "saudacao" && incoming !== "saudacao") return incoming;
  if (current === "duvidas_gerais" && incoming !== "duvidas_gerais") return incoming;
  return current;
}

function requiredMissing(state: ConversationState): Array<"nome" | "modelo" | "ano"> {
  const missing: Array<"nome" | "modelo" | "ano"> = [];
  if (!state.nome) missing.push("nome");
  if (!state.veiculo_modelo) missing.push("modelo");
  if (!state.veiculo_ano) missing.push("ano");
  return missing;
}

function buildMissingPrompt(state: ConversationState): string {
  const missing = requiredMissing(state);
  if (missing.length === 0) {
    if (!state.data_desejada) {
      return "Perfeito 👍 Qual data você prefere para levar o veículo? (ex.: hoje, amanhã, sexta)";
    }
    return "Perfeito! Posso confirmar esse atendimento?";
  }
  if (missing.length === 1 && missing[0] === "nome") {
    return "Perfeito. Pode me informar seu nome?";
  }
  if (missing.length === 1 && missing[0] === "modelo") {
    return "Perfeito. Qual o modelo do veículo?";
  }
  if (missing.length === 1 && missing[0] === "ano") {
    return "Perfeito. Qual o ano do veículo?";
  }
  if (missing.length === 2 && !state.nome) {
    return "Pode me informar seu nome e o modelo do veículo?";
  }
  if (missing.length === 2) {
    return "Para seguir, me informe o ano do veículo e a quilometragem aproximada.";
  }
  return "Para seguir certinho, me informe seu nome, modelo e ano do veículo. Se souber, também me passe a quilometragem.";
}

function ensureNaturalReply(state: ConversationState, reply: string): string {
  const sameAsLast = state.lastBotReply && normalizeText(state.lastBotReply) === normalizeText(reply);
  if (!sameAsLast) return reply;

  if (/nome/i.test(reply)) return "Fico no aguardo do seu nome para continuar 👍";
  if (/modelo/i.test(reply) || /veiculo/i.test(reply)) {
    return "Me passe os dados do veículo que eu continuo por aqui 👍";
  }
  return "Perfeito, sigo aqui com você. Me envie os dados para avançarmos.";
}

function updateStateWithEntities(state: ConversationState, stitchedMessage: string): void {
  const nlp = analyzeMessage(stitchedMessage);

  state.intent = pickIntent(state.intent, nlp.intent);
  if (nlp.entities.nome) state.nome = nlp.entities.nome;
  if (nlp.entities.veiculo_modelo) state.veiculo_modelo = nlp.entities.veiculo_modelo;
  if (nlp.entities.veiculo_ano) state.veiculo_ano = nlp.entities.veiculo_ano;
  if (nlp.entities.quilometragem) state.quilometragem = nlp.entities.quilometragem;
  if (nlp.entities.data_desejada) state.data_desejada = nlp.entities.data_desejada;
  if (nlp.entities.periodo_desejado) state.periodo_desejado = nlp.entities.periodo_desejado;
  if (nlp.entities.tipo_servico) state.tipo_servico = nlp.entities.tipo_servico;
}

function shouldCollectScheduleData(state: ConversationState): boolean {
  return (
    state.intent === "agendamento_servico" ||
    state.intent === "consulta_disponibilidade" ||
    state.intent === "orcamento"
  );
}

function getStepForState(state: ConversationState): ConversationStep {
  if (state.etapa === "atendimento_humano" || state.etapa === "agendado") return state.etapa;
  if (requiredMissing(state).length > 0) return "coletando_dados";
  if (state.data_desejada) return "aguardando_confirmacao";
  return "coletando_dados";
}

export async function handleIncomingMessage(
  phone: string,
  message: string,
  deps: HandleIncomingDeps
): Promise<HandleIncomingResult> {
  const now = deps.now?.() ?? new Date();
  const incomingText = message.trim();
  const existing = await deps.store.getByPhone(phone);
  const state = existing ?? createInitialState(phone, now);

  addRecentMessage(state, "user", incomingText, now);
  const stitched = stitchUserMessages(state, now) || incomingText;
  const nlp = analyzeMessage(stitched);
  const inactive = hasLongInactivity(state, now);

  updateStateWithEntities(state, stitched);
  state.lastInteractionAt = now.toISOString();

  let reply = "";
  let action: HandleIncomingResult["action"] = "none";

  if (state.etapa === "atendimento_humano") {
    reply = "Seu atendimento está com nossa equipe humana. Se quiser, posso registrar mais detalhes para agilizar.";
  } else if (!state.intent || state.intent === "saudacao") {
    if (!state.greetedOnce || inactive) {
      state.greetedOnce = true;
      reply = "Olá! Como posso te ajudar hoje? Posso te atender com agendamento, orçamento ou dúvidas.";
    } else {
      reply = "Me conta rapidinho: você quer agendar, orçamento ou tirar alguma dúvida?";
    }
  } else if (state.intent === "localizacao_horario") {
    reply = "Claro! Te passo endereço e horário de atendimento. Se quiser, já aproveito para abrir seu agendamento.";
  } else if (shouldCollectScheduleData(state)) {
    state.etapa = getStepForState(state);

    if (state.etapa === "coletando_dados") {
      reply = buildMissingPrompt(state);
    } else if (state.etapa === "aguardando_confirmacao") {
      if (state.data_desejada && !state.periodo_desejado) {
        reply = `Perfeito, ${state.nome ?? "obrigado"} 👍 Vou verificar disponibilidade para ${state.data_desejada}. Qual período prefere: manhã ou tarde?`;
      } else if (state.data_desejada && state.periodo_desejado && !nlp.isAffirmative) {
        reply = `Perfeito 👍 Tenho ${state.veiculo_modelo} ${state.veiculo_ano}${state.quilometragem ? ` com ${state.quilometragem}` : ""} para ${state.data_desejada} no período da ${state.periodo_desejado === "manha" ? "manhã" : "tarde"}. Posso confirmar?`;
      } else if (nlp.isAffirmative) {
        if (deps.availabilityChecker && state.data_desejada) {
          action = "check_availability";
          const result = await deps.availabilityChecker({
            phone,
            dateText: state.periodo_desejado
              ? `${state.data_desejada} ${state.periodo_desejado}`
              : state.data_desejada,
            serviceType: state.tipo_servico,
          });
          if (result.available) {
            state.etapa = "agendado";
            action = "schedule";
            reply = `Perfeito 👍 Agendamento confirmado para ${state.data_desejada}. ${result.note ?? ""}`.trim();
          } else {
            state.etapa = "coletando_dados";
            reply = result.note
              ? `Esse horário não está disponível. ${result.note}`
              : "Esse horário não está disponível. Quer tentar outro dia/horário?";
          }
        } else {
          state.etapa = "agendado";
          action = "schedule";
          reply = `Perfeito 👍 Vou seguir com o agendamento para ${state.data_desejada}.`;
        }
      } else if (nlp.isNegative) {
        state.etapa = "coletando_dados";
        reply = "Sem problema. Me diga o que você quer ajustar (data, veículo ou serviço).";
      } else {
        reply = `Tenho aqui: ${state.nome}, ${state.veiculo_modelo} ${state.veiculo_ano}${state.quilometragem ? `, ${state.quilometragem}` : ""} para ${state.data_desejada}. Posso confirmar?`;
      }
    }
  } else if (state.intent === "duvidas_gerais") {
    reply = "Perfeito! Me explica sua dúvida que eu te ajudo agora.";
  }

  if (!reply) {
    reply = "Perfeito. Me passa mais um detalhe para eu continuar seu atendimento.";
  }

  reply = ensureNaturalReply(state, reply);
  addRecentMessage(state, "assistant", reply, now);
  state.lastBotReply = reply;
  state.lastBotReplyAt = now.toISOString();

  await deps.store.save(state);

  return { reply, state, action };
}
