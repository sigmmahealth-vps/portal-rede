-- 0047_eval_cycle_exclusions.sql
-- Exclusão individual (prestador × local) da abertura de um ciclo, com motivo e
-- autor (dupla checagem — spec 2026-09-11). Linha aqui = fica fora do ciclo.
CREATE TABLE IF NOT EXISTS eval_cycle_exclusions (
  id          BIGSERIAL PRIMARY KEY,
  cycle_id    BIGINT NOT NULL REFERENCES eval_cycles(id) ON DELETE CASCADE,
  provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES provider_locations(id) ON DELETE CASCADE,
  reason      TEXT   NOT NULL,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, provider_id, location_id)
);
CREATE INDEX IF NOT EXISTS eval_cycle_exclusions_cycle_idx ON eval_cycle_exclusions (cycle_id);
