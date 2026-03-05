# Análise: Problemas na Lógica de Processamento de Mensagens

## 1. Resumo dos Problemas Identificados

| # | Problema | Causa raiz | Arquivo(s) |
|---|----------|------------|------------|
| 1 | Bot pede nome mais de uma vez | Múltiplos pontos de entrada pedem nome sem checar `intakeStage` ou `contactName` de forma consistente; fluxos paralelos (óleo, reserva, saudação) competem | conversation-orchestrator.ts |
| 2 | Bot pede dados do veículo mesmo com CRM preenchido | `vehicleSlots` vem de `contact_memories` + `metadata`; CRM pode usar outra fonte; fluxos checam `intakeStage` antes de checar se já tem dados | loadConversationContext, awaiting_vehicle |
| 3 | Respostas duplicadas | Mesma pergunta disparada por mensagens diferentes (ex: "bom dia" e "meu carro vazando" ambas acionam "Qual é o seu nome?") | greeting block, oil flow |
| 4 | "sei sim, 5W30" trata só sim/não | `awaitingOilYesNo` checa `isSimpleAffirmative` antes de `extractOilSpec`; ignora óleo na mesma mensagem | ~linha 3095 |

---

## 2. Fluxo Atual e Onde Quebra

### 2.1 Fluxo geral

```
Webhook → persiste msg → Engine (debounce 2s) → fetchCombinedInboundContent
  → processMessageReceivedRules (automação)
  → processInboundMessage (orquestrador)
  → sendMessage (replies)
```

### 2.2 Problema 1: Nome pedido mais de uma vez

**Cenário:** "bom dia" → "meu carro vazando" → "queria ver se consigo levar hoje"

**O que acontece:**
1. Buffer combina "bom dia meu carro vazando" (ou processa separado).
2. Detecta intenção de óleo → fluxo de óleo.
3. Óleo precisa de nome/veículo → `persistIntakeStage(awaiting_name)` e pergunta nome.
4. Usuário envia "queria ver se consigo levar hoje".
5. `looksLikeReservationIntent` = true.
6. Entra no fluxo de **reserva** (`reservationFlow.collectionStage = "collect_profile"`).
7. `buildMissingReservationProfileReply(missingName=true)` → "Antes de confirmar, qual é o seu *nome*?".
8. Não há checagem de “já perguntamos nome e estamos em awaiting_name”.

**Causa:** O fluxo de reserva usa `missingNameProfileAtEntry` e `missingVehicleProfileAtEntry` calculados no início. Se o usuário não enviou nome ainda, `missingName` continua true e o fluxo pede nome de novo, sem considerar que já estamos em `awaiting_name`.

**Trechos relevantes:**
- `buildMissingReservationProfileReply` (linha ~1854): retorna "Antes de confirmar, qual é o seu *nome*?" quando `missingName`.
- Bloco de `reservationFlow.collectionStage === "collect_profile"` (linha ~6200+): usa `buildSmartMissingReservationProfileReply` sem checar se acabamos de perguntar o nome.
- Bloco de saudação (linha ~4710): pergunta nome quando `!hasKnownName` e `looksLikeGreeting`, sem checar `wasRecentNamePrompt`.

### 2.3 Problema 2: Dados do veículo ignorados

**Fonte de dados em `loadConversationContext`:**
- `contact_memories`: `vehicle_model`, `vehicle_year`, `vehicle_km`
- `metadata.vehicleSlots`: slots da conversa atual
- `vehicleSlots = merge(memoryVehicleSlots, metadataSlots)`

**Possíveis causas:**
1. **CRM diferente de `contact_memories`:** Se o painel salva em outra tabela (ex.: `contacts` ou tabela de CRM), esses dados não entram em `vehicleSlots`.
2. **`intakeStage` vs. dados:** Em `awaiting_vehicle`, o código checa `hasVehicleProfileForCurrentNeed` (modelo+ano ou modelo+ano+km). Se `ctx.vehicleSlots` já tiver modelo e ano, deveria avançar. O problema pode ser:
   - `vehicleSlots` vindo vazio ou incompleto;
   - Outro fluxo (ex.: óleo) entrando antes e pedindo veículo sem checar memória.
3. **Ordem de checagem:** Alguns blocos checam `intakeStage === "awaiting_vehicle"` e pedem veículo sem antes checar `getMissingSlots(ctx.vehicleSlots)`.

**Trecho crítico (linha ~4109):**
```ts
} else {
  await options.sendMessage(
    ctx.conversationId,
    requiresFullVehicleProfile
      ? "Para continuar esse atendimento, me informe *modelo, ano e km* do veículo."
      : buildMissingVehicleRequiredReply(getMissingSlots(ctx.vehicleSlots ?? {}))
  );
}
```
Aqui `getMissingSlots` é usado, mas em outros pontos a mensagem é genérica ("modelo, ano e km") sem checar o que falta.

### 2.4 Problema 3: Respostas duplicadas

**Cenário:** "bom dia" → "meu carro ta vazando óleo" → bot repete "Bom dia! Qual é o seu nome?"

**Possíveis causas:**
1. **Dois webhooks processando:** Com debounce de 2s, se as mensagens chegarem com intervalo > 2s, cada uma pode disparar um processamento. O primeiro responde "Qual é o seu nome?"; o segundo, ao processar "meu carro ta vazando óleo", pode entrar no bloco de saudação ou óleo e perguntar nome de novo.
2. **Mesma lógica, mensagens diferentes:** "bom dia" e "meu carro vazando" podem acionar o mesmo bloco (saudação ou óleo) que pede nome, gerando a mesma frase.
3. **`DUPLICATE_REPLY_WINDOW_MS`:** O webhook evita enviar a mesma mensagem em 20s, mas isso só vale para o envio. Se a lógica gerar a mesma pergunta em processamentos diferentes, ambos podem ser enviados em janelas diferentes.

### 2.5 Problema 4: "sei sim, 5W30" — extração de múltiplos slots

**Fluxo atual (linha ~3095):**
```ts
if (oilFlowState.awaitingOilYesNo) {
  if (isSimpleAffirmative(ctx.messageContent)) {
    await persistOilFlowState(..., { awaitingOilSpec: true });
    await options.sendMessage(ctx.conversationId, "Consegue me falar o óleo?");
    return ...;
  }
  // ...
}
```

**Problema:** "sei sim, 5W30" é tratado como `isSimpleAffirmative` e o sistema pede o óleo de novo, ignorando o "5W30" na mesma mensagem.

**Solução:** Antes de `isSimpleAffirmative`, checar `extractOilSpec(ctx.messageContent)`. Se houver óleo, usar direto e seguir para busca de produto, sem pedir de novo.

---

## 3. Soluções Propostas (Mínimas)

### 3.1 Evitar repetir pergunta de nome

**Ação:** Antes de pedir nome, checar `wasRecentNamePrompt` ou equivalente.

**Onde:** Em todos os blocos que pedem nome:
- Fluxo de reserva (`buildSmartMissingReservationProfileReply` / `collect_profile`)
- Bloco de saudação
- Fluxo de óleo quando precisa de nome

**Implementação sugerida:**
```ts
// Antes de enviar "qual é o seu nome?" ou "Antes de confirmar, qual é o seu nome?"
const recentlyAskedName = await wasRecentNamePrompt(ctx.conversationId);
if (recentlyAskedName && !extractCustomerName(intentProbeText, { allowSingleWord: true })) {
  // Usuário ainda não enviou nome; não repetir a pergunta
  return { didReply: false, decision: "silence", reason: "Aguardando nome sem repetir prompt", silence: true };
}
```

Ou criar `shouldSuppressRepeatedNamePrompt` (similar a `shouldSuppressRepeatedNeedPrompt`) e usá-lo em todos os pontos que pedem nome.

### 3.2 Usar dados existentes antes de pedir veículo

**Ação:** Sempre checar `getMissingSlots(ctx.vehicleSlots)` antes de pedir modelo/ano/km.

**Onde:**
- Bloco `awaiting_vehicle` (linha ~3921)
- Fluxos de óleo que pedem veículo
- Qualquer lugar que use "me informe modelo, ano e km" de forma fixa

**Implementação:** Substituir mensagens fixas por `buildMissingVehicleRequiredReply(getMissingSlots(ctx.vehicleSlots ?? {}))`. Se `getMissingSlots` retornar `[]`, não pedir veículo e avançar o fluxo.

### 3.3 Evitar respostas duplicadas

**Ação 1:** Garantir que, após perguntar nome, não se entre em outro fluxo que pergunta nome de novo na mesma “rodada” de processamento.

**Ação 2:** Reforçar o debounce para reduzir processamentos paralelos (já em 2s).

**Ação 3:** Ampliar `DUPLICATE_REPLY_WINDOW_MS` ou incluir mais variações de “pergunta de nome” no critério de duplicata.

### 3.4 Extrair óleo em "sei sim, 5W30"

**Ação:** No bloco `oilFlowState.awaitingOilYesNo`, checar `extractOilSpec` antes de `isSimpleAffirmative`.

**Implementação:**
```ts
if (oilFlowState.awaitingOilYesNo) {
  const oilInMessage = extractOilSpec(ctx.messageContent);
  if (oilInMessage) {
    // Usuário já passou o óleo na mesma mensagem
    await persistOilFlowState(ctx.conversationId, conversationMetadata, {
      awaitingOilYesNo: false,
      awaitingOilSpec: false,
    });
    // Seguir para busca de produto com oilInMessage
    // (reutilizar lógica de oilFlowState.awaitingOilSpec)
    // ...
    return ...;
  }
  if (isSimpleAffirmative(ctx.messageContent)) {
    // ... fluxo atual
  }
  // ...
}
```

---

## 4. Melhorias Estruturais Sugeridas

### 4.1 Centralizar checagem “posso perguntar X?”

Criar helpers como:
- `canAskForName(ctx): Promise<boolean>`
- `canAskForVehicle(ctx): boolean`

E usá-los em todos os fluxos antes de pedir nome ou veículo.

### 4.2 Unificar fonte de dados do “CRM”

Se o painel usa outra tabela para veículo, criar uma camada que:
- Leia de `contact_memories` e da tabela do CRM
- Retorne um `vehicleSlots` unificado para o orquestrador

### 4.3 Ordem de prioridade dos fluxos

Definir prioridade explícita, por exemplo:
1. Fluxos com estado explícito (óleo, reserva, etc.)
2. Checagem de dados já coletados
3. Blocos genéricos (saudação, etc.)

Assim, fluxos específicos não são sobrescritos por blocos genéricos que repetem perguntas.

### 4.4 Idempotência no processamento

Garantir que processar a mesma mensagem duas vezes (por race ou retry) não gere duas respostas. Ex.: salvar um “lastProcessedMessageId” ou similar e ignorar reprocessamento.

---

## 5. Arquivos Principais

| Arquivo | Responsabilidade |
|---------|------------------|
| `conversation-engine/engine.ts` | Buffer, debounce, combinação de mensagens |
| `orchestration/conversation-orchestrator.ts` | Fluxos, intake, coleta de dados |
| `orchestration/...` (loadConversationContext) | Carregamento de contexto (vehicleSlots, contactName, etc.) |
| `contact-memories.ts` | Memórias do contato (vehicle_model, etc.) |
| `webhooks/whatsapp/route.ts` | Recebimento de mensagens e envio de respostas |

---

## 6. Próximos Passos Recomendados

1. Implementar checagem `wasRecentNamePrompt` / `shouldSuppressRepeatedNamePrompt` antes de pedir nome.
2. No bloco `awaitingOilYesNo`, checar `extractOilSpec` antes de `isSimpleAffirmative`.
3. Revisar todos os pontos que pedem veículo e garantir uso de `getMissingSlots(ctx.vehicleSlots)`.
4. Verificar onde o CRM persiste dados de veículo e alinhar com `contact_memories` ou criar camada de unificação.
