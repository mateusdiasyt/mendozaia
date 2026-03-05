# Verificação: Prompt vs Código

## O que o prompt (template Oficina Mecânica) diz

### CONTROLE DE MEMÓRIA E CONTEXTO
- **"Ignore dados de veículo da memória — use só o que está nesta conversa"**
- **"Não salve modelo, ano ou quilometragem em [MEMÓRIA:...]"**
- Definição da etapa pelas mensagens recentes
- ETAPA 1, 2, 3, 4 com fluxo específico

### Placeholders
- `[NOME_ATENDENTE]`, `[NOME]`, `[CIDADE]`, `[VEICULOS_ATENDIDOS]`

---

## O que o código faz (verificação)

| Item do prompt | Usado corretamente? | Detalhes |
|----------------|---------------------|----------|
| Ignorar veículo da memória | ✅ Sim | `ai-agent.ts` filtra `vehicle_model`, `vehicle_year`, `vehicle_km`, `vehicle_oil_spec` das memórias enviadas à IA via `VEHICLE_MEMORY_KEYS`. |
| Não salvar veículo em [MEMÓRIA:...] | ✅ Sim | Memórias extraídas do output da IA (`[MEMÓRIA:key=value]`) são filtradas: chaves de veículo não são salvas. O orquestrador continua persistindo veículo via `saveContactMemory` para uso próprio entre sessões. |
| [DADOS EXTRAÍDOS DA CONVERSA] | ✅ Sim | Quando há `vehicleSlots`, o ai-agent injeta no prompt. |
| Placeholders [NOME], [CIDADE], etc. | ⚠️ Manual | Não há substituição automática. O usuário deve substituir manualmente ao usar o template. |
| ETAPA 1, 2, 3, 4 | ⚠️ Parcial | O **orquestrador** faz muita lógica determinística e responde ANTES da IA. A IA só é chamada em certos casos. O fluxo de etapas do prompt pode ser pouco usado. |
| [VEICULOS_ATENDIDOS] | ⚠️ Manual | Placeholder no prompt. A política real de veículos está em `vehicleServicePolicy` (ano mínimo, modelos bloqueados) — aplicada pelo orquestrador, não pelo prompt. |

---

## Correções aplicadas

1. **Filtrar dados de veículo das memórias** – `ai-agent.ts` filtra `vehicle_model`, `vehicle_year`, `vehicle_km`, `vehicle_oil_spec` tanto ao montar o prompt quanto ao salvar memórias extraídas do output da IA.
