-- =============================================================================
-- 0006_eval_script_status.sql
-- Ciclo de vida do roteiro de qualificação.
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS).
--
-- status: 'rascunho' | 'ativo' | 'arquivado'  (default 'ativo')
-- Versão/vigência NÃO precisa de coluna nova: source_file + version já existem
-- (0001_baseline.sql) e "vigente/substituído" é derivado em consulta.
-- =============================================================================

ALTER TABLE eval_scripts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';
