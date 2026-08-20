-- 0036_user_locations.sql
-- Acesso multi-unidade: o escopo do login passa a ser um CONJUNTO de unidades
-- (user_locations), permitindo agrupar um subconjunto sob um e-mail. Mantém
-- "1 responsável por unidade" via UNIQUE(location_id). Fronteira de CNPJ
-- garantida por FK composta com provider_id. Substitui o escalar users.location_id
-- (aposentado na 0037).

-- Pré-requisitos das FKs compostas (índices baratos; alvos de FK precisam ser UNIQUE):
CREATE UNIQUE INDEX IF NOT EXISTS users_id_provider_uk ON users (id, provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_locations_id_provider_uk ON provider_locations (id, provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_locations_provider_sgu_uk
  ON provider_locations (provider_id, sgu_location_code);  -- chave de upsert da Fatia 0

-- Flag explícita: o admin marca um login como "agrupado" (cobre subconjunto).
ALTER TABLE users ADD COLUMN IF NOT EXISTS agrupado boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_locations (
  user_id      bigint NOT NULL,
  location_id  bigint NOT NULL,
  provider_id  bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id),
  -- 1 responsável por unidade:
  CONSTRAINT user_locations_location_uk UNIQUE (location_id),
  -- Fronteira de tenant: user e location têm que ser do MESMO provider (cross-CNPJ é rejeitado no INSERT):
  CONSTRAINT user_locations_user_fk
    FOREIGN KEY (user_id, provider_id) REFERENCES users (id, provider_id) ON DELETE CASCADE,
  CONSTRAINT user_locations_location_fk
    FOREIGN KEY (location_id, provider_id) REFERENCES provider_locations (id, provider_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS user_locations_user_idx ON user_locations (user_id);

-- Backfill: 1 vínculo por login que hoje tem location_id não-nulo. Os location_id
-- NULL de hoje (órfãos de reimport) NÃO viram vínculo — ficam sem linha e aparecem
-- como "precisa responsável" para o admin (default DENY, nunca grant automático).
-- O JOIN por provider_id blinda contra dado legado inconsistente (location de outro
-- prestador): a linha mismatched cai no mesmo balde "sem vínculo" em vez de abortar
-- a migration inteira via violação da FK composta.
INSERT INTO user_locations (user_id, location_id, provider_id)
SELECT u.id, u.location_id, u.provider_id
  FROM users u
  JOIN provider_locations pl ON pl.id = u.location_id AND pl.provider_id = u.provider_id
 WHERE u.location_id IS NOT NULL AND u.provider_id IS NOT NULL
ON CONFLICT DO NOTHING;
