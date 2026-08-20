-- 0035_users_location.sql
-- Acesso por unidade: 1 usuário por par (prestador, endereço), substituindo o
-- acesso único por prestador da 0034. eval_instances, planos e certificados já
-- são por location_id — o login passa a carregar a unidade e o portal do
-- prestador só enxerga a dela.
--
-- ON DELETE SET NULL (e não CASCADE) por causa do reimport destrutivo de
-- cadastro: apagar endereços não pode apagar usuários. Usuário de prestador com
-- location_id NULL = vínculo perdido; o portal cai no comportamento antigo
-- (enxerga o prestador inteiro) até o admin re-vincular.
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id bigint
  REFERENCES provider_locations(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS users_provider_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS users_location_id_unique
  ON users (location_id) WHERE location_id IS NOT NULL;
