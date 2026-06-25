-- 0011_access_logs_action_meta.sql
-- Adiciona colunas action (tipo do evento) e meta (payload estruturado) em access_logs.
-- Fix do plano de cadastro de usuários — o plano assumiu, incorretamente, que essas colunas já existiam.

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS meta JSONB;

CREATE INDEX IF NOT EXISTS access_logs_action_idx ON access_logs (action) WHERE action IS NOT NULL;
