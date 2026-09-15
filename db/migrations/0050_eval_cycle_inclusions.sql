-- 0050_eval_cycle_inclusions.sql
-- Inclusão avulsa (prestador × local) num ciclo JÁ ABERTO, com motivo e autor —
-- espelho das exclusões (0047), para credenciados/unidades que chegaram depois
-- da abertura (spec 2026-09-15). Linha aqui = ato de inclusão + instância criada.
CREATE TABLE IF NOT EXISTS eval_cycle_inclusions (
  id          BIGSERIAL PRIMARY KEY,
  cycle_id    BIGINT NOT NULL REFERENCES eval_cycles(id) ON DELETE CASCADE,
  provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES provider_locations(id) ON DELETE CASCADE,
  instance_id BIGINT REFERENCES eval_instances(id) ON DELETE SET NULL,
  reason      TEXT   NOT NULL,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, provider_id, location_id)
);
CREATE INDEX IF NOT EXISTS eval_cycle_inclusions_cycle_idx ON eval_cycle_inclusions (cycle_id);
