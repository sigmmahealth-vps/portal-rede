-- 0059_sgu_sync_runs_report.sql
-- Comparação diária sgu_providers_raw × cadastro (spec 2026-10-14): cada execução
-- guarda o relatório completo e a dh_carga da raw comparada.
ALTER TABLE sgu_sync_runs ADD COLUMN IF NOT EXISTS report jsonb;
ALTER TABLE sgu_sync_runs ADD COLUMN IF NOT EXISTS raw_loaded_at timestamp;
