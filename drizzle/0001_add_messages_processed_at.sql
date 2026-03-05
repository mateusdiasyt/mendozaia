-- Adiciona coluna processed_at em messages (evita processar mensagens duas vezes)
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "processed_at" timestamp;
