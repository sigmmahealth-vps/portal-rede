-- 0037_drop_users_location_id.sql
-- Escopo migrou 100% para user_locations (0036). A coluna escalar users.location_id
-- era segunda fonte de verdade de autorizacao — aposentada apos remover todos os
-- writers/readers de auth (Fatia 2 tirou os readers; esta fatia removeu os writers).
DROP INDEX IF EXISTS users_location_id_unique;
ALTER TABLE users DROP COLUMN IF EXISTS location_id;
