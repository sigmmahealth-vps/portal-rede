-- =============================================================================
-- 0007_eval_script_revisao.sql
-- Revisão da planilha + data da revisão (exibidas na tela de roteiros).
-- Aditiva e idempotente. A coluna "version" (contador sequencial / vigência)
-- NÃO muda; estas colunas guardam a revisão informada na própria planilha.
--   revisao:      número da revisão da planilha (ex.: "02")
--   revisao_date: data da revisão (ex.: 2026-01-28)
-- =============================================================================

ALTER TABLE eval_scripts
  ADD COLUMN IF NOT EXISTS revisao      text,
  ADD COLUMN IF NOT EXISTS revisao_date date;
