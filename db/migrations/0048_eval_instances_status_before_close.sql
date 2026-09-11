-- 0048_eval_instances_status_before_close.sql
-- Guarda o status vigente quando o ciclo encerra, para a reabertura/prorrogação
-- (spec 2026-09-11) restaurar com fidelidade. NULL = instância nunca encerrada
-- por ciclo, ou encerrada antes desta migration (reabertura usa fallback).
ALTER TABLE eval_instances ADD COLUMN IF NOT EXISTS status_before_close TEXT;
