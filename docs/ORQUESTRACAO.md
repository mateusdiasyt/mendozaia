# Arquitetura de Orquestração de IA

## Visão Geral

O sistema evoluiu para uma arquitetura de orquestração profissional, onde a IA **nunca responde diretamente** ao webhook. Toda mensagem passa pelo `ConversationOrchestrator`.

## Slot Filling (modelo, ano, km)

Para fluxos de mecânica, o orquestrador extrai dados estruturados das mensagens e injeta no prompt:
- **modelo**, **ano**, **quilometragem** são extraídos por regex
- Armazenados em `conversationStateMetadata.vehicleSlots`
- A IA recebe: `[DADOS EXTRAÍDOS - use estes dados, não peça de novo]`
- Correções são aplicadas (última mensagem sobrescreve)

```
Cliente → Webhook → Automação → Orquestrador → [Decisão] → IA (se permitido) → Filtro → Envio
```

## 1. Arquivos Novos

| Arquivo | Responsabilidade |
|---------|------------------|
| `src/lib/orchestration/types.ts` | Estados, decisões, tipos |
| `src/lib/orchestration/logger.ts` | Logs em `orchestration_logs` |
| `src/lib/orchestration/handoff.ts` | `handoffToHuman()`, `resumeFromHuman()` |
| `src/lib/orchestration/response-filter.ts` | Sanitização e formatação WhatsApp |
| `src/lib/orchestration/conversation-orchestrator.ts` | Orquestrador principal |
| `src/lib/orchestration/index.ts` | Exports públicos |

## 2. Alterações Realizadas

### Schema (`src/lib/db/schema.ts`)
- **conversations**: `conversationState`, `handoffReason`, `handoffAt`, `isPriority`, `conversationStateMetadata`
- **orchestration_logs**: nova tabela para logs

### Webhook (`src/app/api/webhooks/whatsapp/route.ts`)
- IA não é mais chamada diretamente
- Fluxo: automação → `processInboundMessage` (orquestrador)
- Orquestrador decide se chama IA e aplica filtro de resposta

### Automação (`src/lib/automation/engine.ts`)
- `ASSIGN_TO_HUMAN` agora chama `handoffToHuman()`

### Messages (`src/app/actions/messages.ts`)
- `setConversationAIEnabled` limpa handoff e reseta estado para `init`

## 3. Estados da Conversa

| Estado | IA responde? | Descrição |
|--------|--------------|-----------|
| `init` | Sim | Início, fluxo normal |
| `collecting_info` | Sim | Coletando dados |
| `awaiting_system` | Só mensagens neutras | Aguardando sistema |
| `ready_to_confirm` | Sim | Pronto para confirmar |
| `waiting_human` | **Não** | Aguardando atendimento humano |
| `human_active` | **Não** | Humano atendendo |
| `closed` | **Não** | Conversa encerrada |

## 4. Decisões do Orquestrador

- **human_only**: Estado WAITING_HUMAN/HUMAN_ACTIVE ou IA pausada
- **silence**: Mensagem vazia, muito curta, conversa fechada
- **automation_only**: IA desativada
- **ai_respond** / **tool_then_ai**: Chama IA com contexto

## 5. Handoff Humano

### handoffToHuman(conversationId, organizationId, reason?)
- Atualiza estado para `WAITING_HUMAN`
- Define `aiDisabledUntil` (1 ano)
- Marca `isPriority: true`
- Registra em logs

### resumeFromHuman(conversationId, organizationId)
- Retorna estado para `init`
- Limpa handoff
- Usado pelo botão "Reativar agora" (via `setConversationAIEnabled`)

### Handoff automático
Quando a IA responde com frases como "direcionar seu atendimento para um mecânico técnico", o orquestrador detecta e chama `handoffToHuman` automaticamente.

## 6. Filtro de Resposta

- Remove `[MEMÓRIA:...]`, trechos de prompt
- Remove identificação como IA
- Limita a 4000 caracteres
- Formata para WhatsApp (*negrito*)

## 7. Logs

Tabela `orchestration_logs`:
- `event`: decision, ai_responded, handoff, resume_from_human
- `stateBefore`, `stateAfter`
- `decision`, `reason`
- `metadata` (JSON)

## 8. Integração Sem Downtime

1. `db:push` aplica novas colunas e tabela
2. Webhook passou a usar orquestrador; fluxo antigo substituído
3. Automação, reservas, memória e Gemini continuam funcionando
4. UI existente (Reativar IA) já funciona com novo schema
