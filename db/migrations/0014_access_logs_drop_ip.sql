-- 0014_access_logs_drop_ip.sql
-- Remove a coluna ip em claro após o backfill (Task 6).
-- ATENÇÃO: só rodar depois que db:backfill-ip-hash terminou com 0 pendências.

ALTER TABLE access_logs DROP COLUMN IF EXISTS ip;
