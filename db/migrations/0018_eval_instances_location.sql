-- 0018_eval_instances_location.sql
-- Habilita avaliação por unidade de atendimento. Instâncias antigas ficam com
-- location_id NULL (compat: front trata como "prestador inteiro").

ALTER TABLE eval_instances
  ADD COLUMN IF NOT EXISTS location_id integer REFERENCES provider_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS eval_instances_provider_location_idx
  ON eval_instances (provider_id, location_id, status);
