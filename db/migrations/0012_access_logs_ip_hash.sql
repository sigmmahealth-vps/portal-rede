-- 0012_access_logs_ip_hash.sql
-- Adiciona ip_hash (HMAC sobre IP truncado) em access_logs.
-- A coluna ip em claro será removida na 0014, após o backfill (Task 6).

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS ip_hash TEXT;
CREATE INDEX IF NOT EXISTS access_logs_ip_hash_idx ON access_logs (ip_hash) WHERE ip_hash IS NOT NULL;
