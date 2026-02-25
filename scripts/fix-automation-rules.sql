-- Migração: adicionar colunas faltantes na tabela automation_rules
-- Execute no SQL Editor do Neon (neon.tech) ou via psql

-- Adiciona condition_type (obrigatório, default 'none')
ALTER TABLE automation_rules 
ADD COLUMN IF NOT EXISTS condition_type text NOT NULL DEFAULT 'none';

-- Adiciona condition_value (opcional)
ALTER TABLE automation_rules 
ADD COLUMN IF NOT EXISTS condition_value jsonb;

-- Adiciona action_type (obrigatório, default 'reply' para linhas existentes)
ALTER TABLE automation_rules 
ADD COLUMN IF NOT EXISTS action_type text NOT NULL DEFAULT 'reply';

-- Adiciona action_payload (opcional)
ALTER TABLE automation_rules 
ADD COLUMN IF NOT EXISTS action_payload jsonb;
