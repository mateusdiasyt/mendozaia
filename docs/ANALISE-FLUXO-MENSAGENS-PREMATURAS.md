# Análise Técnica: Fluxo de Processamento de Mensagens e Respostas Prematuras

Análise da arquitetura atual para entender por que o sistema pode responder antes do usuário terminar de digitar.

---

## 1. Fluxo Completo de Processamento

### Ordem real das etapas

```
1. Webhook POST recebe payload (Evolution API)
   ↓
2. Parse do payload (MESSAGES_UPSERT, PRESENCE_UPDATE ou CONNECTION_UPDATE)
   ↓
3. Se PRESENCE_UPDATE → atualiza contactTypingAt na conversa → return 200
   ↓
4. Se MESSAGES_UPSERT (inbound):
   - Extrai texto/mídia
   - Busca/cria sessão, contato, conversa
   - Insere mensagem em messages (INSERT)
   - Atualiza conversa (lastMessageAt, unreadCount)
   ↓
5. Chama runConversationEngine (AWAIT — síncrono)
   ↓
6. Engine:
   a) Guard: isAiPaused || isHumanOnlyState → return (silence)
   b) Se texto + inboundMessageId:
      - 1º: verifica contactTypingAt → se recente, loop de espera (até 12s)
      - 2º: sleep(MESSAGE_BUFFER_DEBOUNCE_MS) = 2s
      - 3º: verifica se nova mensagem chegou → se sim, debounce (return)
   c) fetchCombinedInboundContent (busca inbound desde último outbound)
   d) processMessageReceivedRules (automação)
   e) processInboundMessage (orquestrador)
   ↓
7. Engine retorna { replies: string[] }
   ↓
8. Webhook: for (reply of replies) executor.sendMessage(convId, reply)
   ↓
9. executor.sendMessage:
   - waitIfContactTyping (até 5s)
   - verifica duplicata (20s)
   - fetch Evolution API sendText
   - INSERT outbound em messages
   - UPDATE conversa
   ↓
10. return NextResponse.json({ ok: true })
```

### Resumo em uma linha

```
Mensagem chega → parse → salva no banco → runConversationEngine (aguarda typing → sleep 2s → debounce check) → fetchCombinedInboundContent → automação → orquestrador → pushReply (array) → return → webhook envia cada reply via executor.sendMessage
```

---

## 2. Controle de Concorrência (Race Condition)

### Verificação no código

Não existe nenhum dos seguintes mecanismos:

- conversation lock
- mutex
- Redis lock
- database lock (SELECT FOR UPDATE, advisory lock)
- in-memory lock
- fila de processamento (queue)

### Comportamento atual

Cada mensagem inbound dispara um **webhook HTTP independente**. Cada webhook:

1. Persiste a mensagem
2. Chama `runConversationEngine` com **await**
3. Aguarda o engine terminar
4. Envia as respostas

**Múltiplos webhooks rodam em paralelo** (cada request é uma goroutine/worker separada). Não há coordenação entre eles.

### Mitigação existente: debounce por comparação de IDs

O engine usa uma forma de "debounce cooperativo":

- Após `sleep(2s)`, consulta a **última mensagem inbound** da conversa
- Se `latestInbound.id !== input.inboundMessageId` → retorna sem processar (silence)
- A ideia: só o webhook da **última** mensagem deve continuar; os demais "desistem"

Isso reduz processamentos duplicados, mas **não é um lock**. Em condições de corrida (vários webhooks acordando ao mesmo tempo), mais de um pode passar no check antes de qualquer um inserir outbound.

---

## 3. Funcionamento do Debounce

### Constante

```typescript
// src/lib/conversation-engine/engine.ts, linha 10
const MESSAGE_BUFFER_DEBOUNCE_MS = 2000;  // 2 segundos
```

### Onde é usada

```typescript
// Linha 193
await sleep(MESSAGE_BUFFER_DEBOUNCE_MS);
```

### Implementação

- Usa `sleep(ms)` = `new Promise(resolve => setTimeout(resolve, ms))`
- É um **sleep fixo** de 2 segundos
- Não cancela execuções anteriores: cada webhook tem seu próprio `setTimeout`
- Não há `clearTimeout` ou cancelamento

### Múltiplos webhooks

Sim, múltiplos webhooks podem processar ao mesmo tempo. O fluxo é:

1. Webhook 1: sleep(2000)
2. Webhook 2: sleep(2000) (inicia em paralelo)
3. Webhook 3: sleep(2000) (inicia em paralelo)
4. …

Após 2s, cada um acorda e faz o check `latestInbound.id !== input.inboundMessageId`. Em teoria, só o da última mensagem continua; os outros retornam em modo debounce.

### Limitação

O debounce **não é por conversa**. Não existe um timer único por conversa que seria resetado a cada nova mensagem. Cada webhook espera 2s fixos a partir do momento em que foi chamado.

---

## 4. Sistema de Buffer de Mensagens

### Função `fetchCombinedInboundContent`

```typescript
// src/lib/conversation-engine/engine.ts, linhas 30-66
async function fetchCombinedInboundContent(
  conversationId: string,
  contentType: string
): Promise<string> {
  // 1. Busca último outbound
  const [lastOutbound] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound")
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const since = lastOutbound?.createdAt ?? new Date(0);

  // 2. Busca inbound desde o último outbound
  const inboundRows = await db
    .select({ content: messages.content, contentType: messages.contentType })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "inbound"),
        gt(messages.createdAt, since)
      )
    )
    .orderBy(asc(messages.createdAt))
    .limit(20);

  const parts = inboundRows
    .filter((m) => m.contentType === "text" && m.content?.trim())
    .map((m) => (m.content ?? "").trim());
  const combined = parts.join(" ").replace(/\s+/g, " ").trim();
  return combined.length > MESSAGE_BUFFER_MAX_CHARS
    ? combined.slice(-MESSAGE_BUFFER_MAX_CHARS)
    : combined;
}
```

### Query usada

- **Último outbound:** `SELECT createdAt FROM messages WHERE conversationId = ? AND direction = 'outbound' ORDER BY createdAt DESC LIMIT 1`
- **Inbound desde então:** `SELECT content, contentType FROM messages WHERE conversationId = ? AND direction = 'inbound' AND createdAt > since ORDER BY createdAt ASC LIMIT 20`

### "Desde o último outbound"

`since = lastOutbound?.createdAt ?? new Date(0)` — ou seja, todas as mensagens inbound após o último outbound (ou desde o início, se não houver outbound).

### Risco de mensagens incompletas

- Não há risco de mensagens “incompletas” no sentido de texto cortado: cada mensagem é um registro completo no banco.
- O risco é de **sequência incompleta**: se o usuário enviar msg1, msg2, msg3 em sequência e o processamento rodar antes de msg3 ser persistida, o buffer terá só msg1 e msg2. O debounce de 2s tenta reduzir isso, mas não elimina totalmente condições de corrida.

---

## 5. Sistema de Detecção de Usuário Digitando

### Onde é salvo

```typescript
// src/app/api/webhooks/whatsapp/route.ts, linhas 194-200
// Quando recebe PRESENCE_UPDATE com presence === "composing" ou "recording"
await db.update(conversations).set({
  contactTypingAt: isTyping ? new Date() : null,
  updatedAt: new Date(),
}).where(eq(conversations.id, conv.id));
```

- **Tabela:** `conversations`
- **Campo:** `contact_typing_at` (timestamp)

### O engine espera o usuário parar de digitar?

Sim, quando o indicador está ativo:

```typescript
// engine.ts, linhas 127-152
if (isRecentTyping(conversationTypingState?.contactTypingAt ?? null)) {
  while (
    typingPauseElapsedMs < CONTACT_TYPING_MAX_PAUSE_MS &&
    isRecentTyping(conversationTypingState?.contactTypingAt ?? null)
  ) {
    await sleep(CONTACT_TYPING_POLL_MS);  // 600ms
    typingPauseElapsedMs += CONTACT_TYPING_POLL_MS;
    // re-consulta contactTypingAt
  }
}
```

### Constantes

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `CONTACT_TYPING_IDLE_WAIT_MS` | 5.000 ms | Considera "digitando" se o último presence foi há menos de 5s |
| `CONTACT_TYPING_POLL_MS` | 600 ms | Intervalo de polling |
| `CONTACT_TYPING_MAX_PAUSE_MS` | 12.000 ms | Tempo máximo de espera (12s) |

### Dependência do Evolution API

O `contactTypingAt` só é atualizado quando o webhook recebe `PRESENCE_UPDATE` com `presence === "composing"` ou `"recording"`. Se a Evolution API:

- não enviar presence,
- enviar com atraso,
- ou enviar de forma esparsa,

o engine pode nunca entrar no loop de espera e ir direto para o debounce de 2s.

---

## 6. Execuções Paralelas do Engine

### Cenário: 5 mensagens em menos de 2 segundos

**Resposta: 5 execuções de `runConversationEngine` em paralelo.**

Cada mensagem gera um webhook e cada webhook chama o engine. Não há lock nem fila.

### Quantas chegam a processar de fato?

Em condições normais, **apenas 1** (a da última mensagem).

Fluxo típico:

1. Msg1 → Webhook1 → sleep(2s)
2. Msg2 → Webhook2 → sleep(2s)
3. …
4. Msg5 → Webhook5 → sleep(2s)

Após ~2s, cada um acorda e faz:

```typescript
if (latestInbound?.id && latestInbound.id !== input.inboundMessageId) {
  return { mode: "debounced", ... };  // desiste
}
```

- Webhooks 1–4: `input.inboundMessageId` ≠ `latestInbound.id` (msg5) → retornam em debounce.
- Webhook 5: `input.inboundMessageId` === `latestInbound.id` → continua e processa.

### Condições de corrida

Se vários webhooks acordarem quase ao mesmo tempo e consultarem `latestInbound` antes de qualquer um inserir outbound, mais de um pode passar no check. Não há garantia atômica.

---

## 7. Momento Exato em que a Resposta é Enviada

### Onde `sendMessage` é chamado

1. **No engine:** `pushReply(replies, text)` — apenas adiciona ao array em memória.
2. **No orquestrador:** `sendMessage(ctx.conversationId, text)` — chama o `sendMessage` passado em `options`, que é o mesmo `pushReply`.
3. **No webhook:** após `runConversationEngine` retornar:

```typescript
// route.ts, linhas 556-575
const engineResult = await runConversationEngine({ ... });

for (const reply of engineResult.replies) {
  await executor.sendMessage(conversation.id, reply);
}
```

### Momento real do envio

O envio ao WhatsApp ocorre em `executor.sendMessage`, que:

1. Chama `waitIfContactTyping` (até 5s)
2. Verifica duplicata (janela de 20s)
3. Faz `fetch` para a Evolution API
4. Insere a mensagem outbound no banco

Ou seja: **a resposta é enviada depois que o engine termina**, no loop do webhook, e não durante o processamento do orquestrador.

---

## 8. Possíveis Causas para Respostas Prematuras

### 1. Presence/typing não chega ou é esporádico

Se a Evolution API não enviar `PRESENCE_UPDATE` ou enviar com atraso, `contactTypingAt` fica `null` ou desatualizado. O engine não entra no loop de espera e vai direto para o debounce de 2s.

### 2. Ordem dos webhooks

Se o webhook da **mensagem** chegar antes do webhook de **presence** (composing → paused/available), o engine pode processar com `contactTypingAt` ainda indicando “digitando” ou já limpo, dependendo do timing.

### 3. Debounce fixo de 2s

O debounce é sempre 2s, independente do contexto. Se o usuário demorar mais para digitar (ex.: 3s entre mensagens), a primeira mensagem já terá sido processada e respondida.

### 4. Ausência de lock por conversa

Vários webhooks podem processar a mesma conversa em paralelo. O debounce por ID reduz, mas não elimina, o risco de múltiplas respostas ou de processar “no meio” de uma sequência.

### 5. `waitIfContactTyping` só antes do envio

A espera por typing no `executor.sendMessage` ocorre **antes de enviar** cada reply, não antes de processar. Se o engine já tiver decidido a resposta, o envio só espera até 5s por typing; se o usuário ainda estiver digitando, a resposta pode ser enviada mesmo assim.

### 6. Mídia e mensagens não-texto

O bloco de typing + debounce só roda quando:

```typescript
input.messageContentType === "text" && input.messageContent.trim() && input.inboundMessageId
```

Para mídia ou mensagens vazias, o engine pula typing e debounce e processa imediatamente.

---

## 9. Sugestões de Melhoria Arquitetural

### Evitar respostas prematuras

1. **Aumentar o debounce** (ex.: 3–4s) para dar mais tempo de agrupar mensagens.
2. **Debounce adaptativo:** aumentar o tempo quando a última mensagem for curta (ex.: “oi”, “ok”).
3. **Presence mais robusto:** tratar ausência de presence como “possivelmente digitando” e esperar um tempo extra antes de processar.
4. **Typing no envio:** manter e, se possível, ampliar `waitIfContactTyping` antes de cada `sendMessage`.

### Evitar múltiplos processamentos

1. **Lock por conversa:** Redis ou advisory lock no Postgres (`pg_advisory_lock`) para garantir que só um processamento rode por conversa por vez.
2. **Fila por conversa:** enfileirar mensagens por conversa e processar em um único worker por conversa.
3. **Processamento assíncrono:** webhook só persiste a mensagem e enfileira; worker dedicado processa com lock por conversa.

### Melhorar o buffer de mensagens

1. **Debounce por conversa:** timer único por conversa, resetado a cada nova mensagem (ex.: “última mensagem há X segundos”).
2. **Janela temporal:** considerar mensagens em uma janela (ex.: últimas 30s) em vez de “desde último outbound”.
3. **Confirmação de “mensagem final”:** se a API permitir, usar algum sinal de “usuário parou de digitar” antes de processar.

---

## Resumo Executivo

| Aspecto | Situação atual |
|---------|----------------|
| **Fluxo** | Webhook → persist → engine (typing wait + 2s debounce) → automação → orquestrador → replies → webhook envia |
| **Concorrência** | Sem lock; múltiplos webhooks em paralelo; debounce por ID como mitigação |
| **Debounce** | Fixo 2s; `sleep`; não cancela execuções anteriores |
| **Buffer** | Inbound desde último outbound; até 20 mensagens; até 2000 chars |
| **Typing** | `contactTypingAt`; espera até 12s; depende de PRESENCE_UPDATE |
| **Paralelismo** | 5 msgs → 5 execuções; em teoria só 1 completa (debounce) |
| **Envio** | Após engine retornar; loop no webhook; `waitIfContactTyping` antes de cada envio |
| **Causa provável de prematuras** | Presence ausente/atrasado + debounce fixo de 2s |
