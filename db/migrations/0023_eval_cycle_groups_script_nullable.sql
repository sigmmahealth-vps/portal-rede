-- 0023_eval_cycle_groups_script_nullable.sql
-- Permite grupo participar do ciclo sem roteiro fixo — roteiro vem por override
-- (prestador × local). Sem linha em eval_cycle_groups = grupo excluído do ciclo.

ALTER TABLE eval_cycle_groups ALTER COLUMN script_id DROP NOT NULL;
