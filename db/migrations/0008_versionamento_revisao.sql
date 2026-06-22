-- =============================================================================
-- 0008_versionamento_revisao.sql
-- A versão do roteiro passa a ser a revisão da planilha.
-- Pré-requisito operacional: a tabela já foi ESVAZIADA (DELETE FROM eval_scripts)
-- antes desta migration — as constraints abaixo assumem base limpa.
--   + implantacao_date (data de implantação, vem da planilha)
--   - revisao  (redundante: a coluna version passa a guardar a revisão)
--   - status   (redundante com a vigência automática vigente/substituída)
--   revisao_date e implantacao_date passam a ser obrigatórias (NOT NULL)
--   unicidade por roteiro: (source_file, version) e (source_file, revisao_date)
-- =============================================================================

ALTER TABLE eval_scripts ADD COLUMN IF NOT EXISTS implantacao_date date;
ALTER TABLE eval_scripts DROP COLUMN IF EXISTS revisao;
ALTER TABLE eval_scripts DROP COLUMN IF EXISTS status;
ALTER TABLE eval_scripts ALTER COLUMN revisao_date SET NOT NULL;
ALTER TABLE eval_scripts ALTER COLUMN implantacao_date SET NOT NULL;

ALTER TABLE eval_scripts DROP CONSTRAINT IF EXISTS eval_scripts_source_version_uq;
ALTER TABLE eval_scripts ADD CONSTRAINT eval_scripts_source_version_uq UNIQUE (source_file, version);
ALTER TABLE eval_scripts DROP CONSTRAINT IF EXISTS eval_scripts_source_revdate_uq;
ALTER TABLE eval_scripts ADD CONSTRAINT eval_scripts_source_revdate_uq UNIQUE (source_file, revisao_date);
