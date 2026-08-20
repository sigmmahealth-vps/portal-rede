-- 0034_users_provider_unique.sql
-- Acesso único por prestador (promessa LGPD da Gestão de Acessos) vira constraint.
-- Antes era só convenção: findProviderUser usa LIMIT 1, e provision-users e
-- POST /providers/:id/access são check-then-insert concorrentes. Ambos os caminhos
-- já tratam 23505. Dry-run de duplicados executado em dev (nenhum) — repetir em
-- homolog/prod antes de aplicar:
--   SELECT provider_id, COUNT(*) FROM users
--    WHERE provider_id IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX users_provider_id_unique
  ON users (provider_id) WHERE provider_id IS NOT NULL;
