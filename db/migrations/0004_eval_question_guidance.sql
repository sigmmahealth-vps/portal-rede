-- =============================================================================
-- 0004_eval_question_guidance.sql
-- A "FORMA DE EVIDÊNCIA" / "OBSERVAÇÃO" de cada critério dos roteiros de
-- qualificação (.xlsx) descreve qual evidência o auditor deve verificar.
-- Guardamos esse texto fielmente para não perder informação na carga (WS4).
-- =============================================================================

ALTER TABLE eval_questions ADD COLUMN IF NOT EXISTS guidance text;
