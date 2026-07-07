-- =============================================================================
-- 0015_provider_roteiro.sql
-- Vínculo do roteiro de avaliação em cada prestador (resultado do match).
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS).
--   eval_script_id  -> FK para eval_scripts (resolvida de FOR-XXX no importador)
--   roteiro_cod     -> 'FOR-017' etc. (rastro do match; null p/ 'A DEFINIR')
--   roteiro_confianca -> Alta|Média|Baixa|A DEFINIR
-- =============================================================================

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS eval_script_id    bigint REFERENCES eval_scripts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS roteiro_cod       text,
  ADD COLUMN IF NOT EXISTS roteiro_confianca text;

CREATE INDEX IF NOT EXISTS providers_eval_script_idx ON providers (eval_script_id);
