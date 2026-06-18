-- =============================================================================
-- 0002_segmentation_columns.sql
-- Colunas de segmentação de avisos/treinamentos que existiam no runtime SQLite
-- (adicionadas via ALTER TABLE no server.ts) e são referenciadas pelas rotas.
-- Mantidas para compatibilidade; uso pleno é de ondas posteriores (S5).
-- =============================================================================

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_type        text DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS target_group       text,
  ADD COLUMN IF NOT EXISTS target_provider_id bigint REFERENCES providers(id) ON DELETE SET NULL;

ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS target_type        text DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS target_group       text,
  ADD COLUMN IF NOT EXISTS target_provider_id bigint REFERENCES providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS announcements_target_provider_idx ON announcements (target_provider_id);
CREATE INDEX IF NOT EXISTS trainings_target_provider_idx ON trainings (target_provider_id);
