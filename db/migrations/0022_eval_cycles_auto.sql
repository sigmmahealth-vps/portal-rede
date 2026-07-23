-- 0022_eval_cycles_auto.sql
-- 5.4.1.1 — abertura/encerramento automáticos por data (opcional por ciclo).

ALTER TABLE eval_cycles ADD COLUMN IF NOT EXISTS auto_open  boolean NOT NULL DEFAULT false;
ALTER TABLE eval_cycles ADD COLUMN IF NOT EXISTS auto_close boolean NOT NULL DEFAULT false;
