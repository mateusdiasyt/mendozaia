# Arquitetura do Engine de Automação — Análise Estrutural

Documento de referência. **Nenhuma alteração de código.**

---

## 1) Estrutura do Estado da Conversa

### Onde é carregado

O estado é carregado em **`loadConversationContext`** (`src/lib/orchestration/conversation-orchestrator.ts`, linhas 2385–2565).

### Objeto `ctx` (OrchestrationContext) retornado

```typescript
// Retorno de loadConversationContext (linhas 2519-2565)
return {
  conversationId: params.conversationId,
  organizationId: params.organizationId,
  contactId: params.contactId,
  contactPhone: params.contactPhone,
  messageContent: params.messageContent,
  messageContentType: params.messageContentType ?? "text",
  conversationState: conv.conversationState ?? CONVERSATION_STATES.INIT,
  aiDisabledUntil: conv.aiDisabledUntil ?? null,
  handoffReason: conv.handoffReason ?? null,
  isPriority: conv.isPriority ?? false,
  assignedToId: conv.assignedToId ?? null,
  reservationsEnabled,
  aiAgentEnabled: aiAgent.enabled !== false,
  aiAgentUseAsFallback: aiAgent.useAsFallback !== false,
  vehicleSlots: shouldExtractVehicleSlots ? vehicleSlots : undefined,
  knownOilSpec: memories.vehicle_oil_spec ?? null,
  usesVehicleSlots,
  contactName: contact?.name ?? null,
  pendingReservation: { dateStr, timeStr, durationMinutes } | undefined,
  reservationSchedule: { start, end, timezone, workingDays, blockedDates },
  businessProfile: { botName, instagram, address, mapsLink, about },
  botConfig: { segment, tone, language },
  vehicleServicePolicy: { minAllowedYear, blockedModels, blockedModelYears },
  offeredServices: string[],
};
```

### Campos derivados do metadata (não vêm direto do ctx)

O `intakeStage` e outros fluxos são obtidos **depois** do `loadConversationContext`, a partir de `conversationStateMetadata`:

```typescript
// Linhas 2819-2839
const [convMetaRow] = await db.select({ conversationStateMetadata: ... }).from(conversations)...
const conversationMetadata = (convMetaRow?.conversationStateMetadata as Record<string, unknown>) ?? {};

const intakeStage = getIntakeStage(conversationMetadata);
const reservationContext = getReservationContext(conversationMetadata);
const vehicleConfirmation = getVehicleConfirmationState(conversationMetadata);
const oilFlowState = getOilFlowState(conversationMetadata);
const workshopState = getWorkshopState(conversationMetadata);
const profileUpdateFlow = getProfileUpdateFlowState(conversationMetadata);
const resumeChoiceFlow = getResumeChoiceFlowState(conversationMetadata);
const reservationFlow = conversationMetadata.reservationFlow ?? {};
```

### Estrutura de `conversationStateMetadata`

```typescript
// Campos possíveis em conversationStateMetadata (JSONB na tabela conversations)
{
  intakeFlow: { stage: "awaiting_name" | "awaiting_vehicle" | "awaiting_need" | "awaiting_issue" | "awaiting_reservation_profile", updatedAt: string },
  reservationContext: { serviceName: string, productName: string, updatedAt: string },
  vehicleSlots: { modelo?: string, ano?: number, km?: number },
  vehicleSlotsUpdatedAt: string,
  pendingReservation: { dateStr, timeStr, durationMinutes },
  vehicleConfirmation: { pending, confirmed, vehicleSignature },
  oilFlow: { awaitingUnknownOilConfirmation, awaitingOilYesNo, awaitingOilSpec, awaitingOilVehicle, awaitingOilScheduleConfirmation },
  workshopFlow: { carInShop, awaitingVehicleDetails },
  profileUpdateFlow: { awaitingConfirmation },
  resumeChoiceFlow: { awaitingChoice },
  reservationFlow: { collectionStage, lastPromptKey, ... },
  reservationPeriodFlow: { ... },
  restaurantReservationFlow: { ... },
}
```

### `intakeStage` e onboarding

```typescript
// getIntakeStage (linhas 1989-2002)
function getIntakeStage(metadata: Record<string, unknown>): IntakeStage | null {
  const intakeFlow = (metadata.intakeFlow as Record<string, unknown> | undefined) ?? {};
  const stage = intakeFlow.stage;
  if (stage === "awaiting_name" || stage === "awaiting_vehicle" || stage === "awaiting_need" || 
      stage === "awaiting_issue" || stage === "awaiting_reservation_profile") {
    return stage;
  }
  return null;
}
```

### lastInboundMessage / lastOutboundMessage

Não existem campos `lastInboundMessage` ou `lastOutboundMessage` no `ctx`. O sistema usa:

- `messageContent`: mensagem atual (ou buffer combinado) passada em `params`
- `fetchCombinedInboundContent`: busca mensagens inbound desde o último outbound
- Consultas diretas à tabela `messages` quando precisa da última mensagem

---

## 2) Origem dos Dados do Veículo

### Fontes de dados

| Fonte | Tabela/Campo | Chaves usadas |
|------|--------------|---------------|
| Memórias do contato | `contact_memories` | `vehicle_model`, `vehicle_year`, `vehicle_km`, `vehicle_oil_spec` |
| Metadados da conversa | `conversations.conversation_state_metadata` | `vehicleSlots` (objeto) |
| Extração em tempo real | `messages` (últimas 20) | `extractSlotsFromMessages` |

Não há tabelas `vehicles`, `contact_vehicle` ou `crm_vehicle`.

### Código que monta `ctx.vehicleSlots`

```typescript
// loadConversationContext, linhas 2467-2493
const metadata = (conv.conversationStateMetadata as Record<string, unknown>) ?? {};
const rememberedYear = memories.vehicle_year ? Number(memories.vehicle_year) : undefined;
const rememberedKm = memories.vehicle_km ? Number(memories.vehicle_km) : undefined;

const memoryVehicleSlots: Partial<VehicleSlots> = {
  modelo: memories.vehicle_model || undefined,
  ano: rememberedYear && Number.isFinite(rememberedYear) ? rememberedYear : undefined,
  km: rememberedKm && Number.isFinite(rememberedKm) ? rememberedKm : undefined,
};

const metadataSlots = metadata.vehicleSlots as VehicleSlots | undefined;
const existingSlots = mergeVehicleSlots(memoryVehicleSlots, metadataSlots ?? {});

let vehicleSlots = existingSlots;
if (shouldExtractVehicleSlots) {
  const recentDesc = await db.select(...).from(messages).where(...).orderBy(desc(createdAt)).limit(20);
  const extracted = extractSlotsFromMessages(recentRows);
  vehicleSlots = mergeVehicleSlots(existingSlots, extracted);
  // Se extraiu algo novo, persiste em metadata e contact_memories
  if (JSON.stringify(vehicleSlots) !== JSON.stringify(existingSlots)) {
    await db.update(conversations).set({ conversationStateMetadata: { ...metadata, vehicleSlots, ... } });
    if (vehicleSlots?.modelo) await saveContactMemory(..., "vehicle_model", ...);
    if (vehicleSlots?.ano) await saveContactMemory(..., "vehicle_year", ...);
    if (vehicleSlots?.km) await saveContactMemory(..., "vehicle_km", ...);
  }
}
```

Fluxo: `contact_memories` + `metadata.vehicleSlots` → merge → extração das últimas 20 mensagens → merge final → `ctx.vehicleSlots`.

---

## 3) Estrutura de vehicleSlots

### Definição em `slot-extractor.ts`

```typescript
// src/lib/orchestration/slot-extractor.ts, linhas 6-10
export interface VehicleSlots {
  modelo?: string;
  ano?: number;
  km?: number;
}
```

Não há campo `oleo` em `VehicleSlots`. O óleo fica em:

- `ctx.knownOilSpec` (string, ex.: "5W30")
- `contact_memories` com chave `vehicle_oil_spec`

---

## 4) Função Principal de Processamento de Mensagens

### Fluxo geral

```
Webhook (route.ts)
  → Persiste mensagem em messages
  → runConversationEngine(input)
      1. Guard: isAiPaused || isHumanOnlyState → return (silence)
      2. Typing wait (se contactTypingAt recente)
      3. Buffer debounce 2s
      4. Se nova mensagem chegou → return (debounced)
      5. fetchCombinedInboundContent → messageContentToProcess
      6. processMessageReceivedRules (automação) → automationDidReply
      7. Se automationDidReply → return (orquestrador não roda)
      8. processInboundMessage (orquestrador)
  → Para cada reply em engineResult.replies: executor.sendMessage()
```

### `processInboundMessage` (orquestrador)

```typescript
// Linhas 2761-2818 (resumo)
export async function processInboundMessage(params, options) {
  const ctx = await loadConversationContext(params);
  if (!ctx) return { didReply: false, ... };

  // Guard: humano ou IA pausada
  if (isHumanOnlyState || isAiPaused) return { didReply: false, ... };

  // Guard: automação já respondeu
  if (options.automationDidReply) return { didReply: true, ... };

  // Carrega metadata e estados derivados
  const conversationMetadata = ...;
  const intakeStage = getIntakeStage(conversationMetadata);
  const oilFlowState = getOilFlowState(conversationMetadata);
  // ... outros getters

  // Sequência de blocos condicionais (ordem importa):
  // - resumeChoiceFlow
  // - hasActiveFlow + looksLikeGreeting
  // - oilFlow (troca de óleo)
  // - looksLikeDirectHumanMechanicalIssue
  // - vehicleConfirmation
  // - shouldAskVehicleConfirmation
  // - intakeStage === "awaiting_name"
  // - intakeStage === "awaiting_vehicle"
  // - fluxos de óleo, reserva, catálogo, etc.
  // - greeting (saudação inicial)
  // - decideNextAction → callAIWithContext (fallback IA)
}
```

Ordem: guards → fluxos com estado (óleo, reserva, etc.) → coleta de dados → saudação → IA.

---

## 5) Função shouldSuppressRepeatedNamePrompt

### Código completo

```typescript
// src/lib/orchestration/conversation-orchestrator.ts, linhas 828-863
async function shouldSuppressRepeatedNamePrompt(
  conversationId: string,
  intentProbeText: string,
  explicitNameIntro: boolean
): Promise<boolean> {
  if (explicitNameIntro) return false;

  const normalized = intentProbeText.trim();
  const isShortOrGreeting =
    normalized.length <= 8 || looksLikeGreeting(intentProbeText);
  if (!isShortOrGreeting) return false;

  const [lastOutbound] = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (!lastOutbound?.content) return false;
  const isRecent =
    Date.now() - lastOutbound.createdAt.getTime() <=
    NAME_PROMPT_REPEAT_WINDOW_MS;
  const asksName =
    /qual\s+(?:e|é)\s+o\s+seu\s+nome\??/i.test(lastOutbound.content) ||
    /qual\s+seria\s+o\s+seu\s+nome\??/i.test(lastOutbound.content);

  return isRecent && asksName;
}
```

### Onde é chamada

```typescript
// Linhas 3715-3740 (dentro do bloco intakeStage === "awaiting_name")
const suppressRepeatedNamePrompt = await shouldSuppressRepeatedNamePrompt(
  ctx.conversationId,
  intentProbeText,
  explicitNameIntro
);
if (suppressRepeatedNamePrompt && !justCapturedName && !latestMessageLooksLikeSingleName) {
  // Retorna sem enviar mensagem (silence)
  return { didReply: false, decision: "tool_then_ai", reason: "Pergunta de nome suprimida", silence: true };
}
```

### Objetivo

Evitar repetir a pergunta de nome quando:

1. A última mensagem do bot pergunta o nome (regex)
2. Foi enviada há menos de `NAME_PROMPT_REPEAT_WINDOW_MS` (45s)
3. A mensagem do usuário é curta (≤8 chars) ou saudação
4. O usuário não fez introdução explícita de nome

### Limitação

Só suprime quando `isShortOrGreeting`. Mensagens longas (ex.: "queria ver se consigo levar hoje") não são suprimidas, mesmo com pergunta de nome recente.

---

## 6) Fluxo de Coleta de Dados do Veículo

### Função que verifica o que falta

```typescript
// src/lib/orchestration/slot-extractor.ts, linhas 211-217
export function getMissingSlots(slots: VehicleSlots): ("modelo" | "ano" | "km")[] {
  const missing: ("modelo" | "ano" | "km")[] = [];
  if (!isValidVehicleModel(slots.modelo)) missing.push("modelo");
  if (!slots.ano) missing.push("ano");
  if (!slots.km) missing.push("km");
  return missing;
}
```

### Onde é usada para decidir o que perguntar

Exemplos:

```typescript
// Linha 2843-2844
const missingVehicleProfileAtEntry = ctx.usesVehicleSlots
  ? getMissingSlots(ctx.vehicleSlots ?? {})
  : [];

// Linha 3132-3134 (fluxo óleo)
const missingVehicle = getMissingSlots(ctx.vehicleSlots ?? {});
const hasModelAndYear = !!(ctx.vehicleSlots?.modelo && ctx.vehicleSlots?.ano);
if (!hasModelAndYear || missingVehicle.length > 0) {
  // Pede modelo/ano/km
  const askVehicle = buildMissingVehicleRequiredReply(missingVehicle.length > 0 ? missingVehicle : ["modelo", "ano"]);
  await options.sendMessage(ctx.conversationId, `${pricePart}. Para seguir com o agendamento, ${askVehicle}`);
}

// Linha 3921+ (intakeStage === "awaiting_vehicle")
const requiresFullVehicleProfile = reservationContext.serviceName === "Revisão" || reservationContext.serviceName === "Troca de Óleo";
const hasVehicleProfileForCurrentNeed = requiresFullVehicleProfile ? hasFullVehicleProfile : hasModelAndYearProfile;
// hasFullVehicleProfile = hasAllVehicleSlots(ctx.vehicleSlots)
// hasModelAndYearProfile = !!(modelo && ano)
```

### Tipo de óleo

O óleo não entra em `vehicleSlots`. É tratado por:

- `ctx.knownOilSpec` (de `contact_memories.vehicle_oil_spec`)
- `oilFlowState.awaitingOilYesNo` / `awaitingOilSpec`
- `extractOilSpec(text)` no orquestrador

Fluxo típico:

1. `shouldAskOilQualification` → pergunta "Você sabe o óleo utilizado no motor? Sim ou não"
2. `awaitingOilYesNo` → se sim, vai para `awaitingOilSpec` e pergunta "Consegue me falar o óleo?"
3. `extractOilSpec` extrai padrões como 5W30

---

## 7) Controle de Envio de Mensagens Duplicadas

### Onde está

No webhook, dentro do `executor.sendMessage`:

```typescript
// src/app/api/webhooks/whatsapp/route.ts, linhas 497-516
const executor = {
  sendMessage: async (convId: string, message: string) => {
    await waitIfContactTyping(convId);
    // ...
    const [lastMessage] = await db
      .select({ direction: messages.direction, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const isDuplicateReply =
      lastMessage?.direction === "outbound" &&
      !!lastMessage?.content &&
      lastMessage.content === message &&
      Date.now() - lastMessage.createdAt.getTime() <= DUPLICATE_REPLY_WINDOW_MS;
    if (isDuplicateReply) {
      return;  // Não envia
    }
    // ... fetch para Evolution API, insert em messages
  },
};
```

### Constante

```typescript
// Linha 66
const DUPLICATE_REPLY_WINDOW_MS = 20 * 1000; // 20 segundos
```

### Comportamento

- Compara a mensagem a enviar com a última mensagem **outbound** da conversa
- Se for igual e tiver sido enviada há menos de 20s → não envia
- Não evita duplicatas entre automação e orquestrador no mesmo processamento (o orquestrador não roda se `automationDidReply`)

---

## Resumo das Tabelas e Campos Relevantes

| Tabela | Campos usados para estado/veículo |
|--------|-----------------------------------|
| `conversations` | `conversation_state`, `conversation_state_metadata`, `ai_disabled_until`, `contact_typing_at` |
| `contacts` | `name` |
| `contact_memories` | `key`/`value`: `vehicle_model`, `vehicle_year`, `vehicle_km`, `vehicle_oil_spec`, `name` |
| `messages` | `direction`, `content`, `created_at` (para buffer, extração de slots, última mensagem) |
