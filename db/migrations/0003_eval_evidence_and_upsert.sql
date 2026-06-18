-- =============================================================================
-- 0003_eval_evidence_and_upsert.sql
-- Itens de schema que o runtime SQLite criava em tempo de execução e que o
-- motor de roteiros (eval_*) depende:
--   * documents.reference_id  — vincula uma evidência (documento) à instância/resposta
--   * índice único eval_answers(instance_id, question_id) — suporta o upsert
--     ON CONFLICT em PUT /api/eval/instances/:id/answers
-- =============================================================================

ALTER TABLE documents ADD COLUMN IF NOT EXISTS reference_id bigint;
CREATE INDEX IF NOT EXISTS documents_reference_idx ON documents (reference_id);

CREATE UNIQUE INDEX IF NOT EXISTS eval_answers_instance_question_uniq
  ON eval_answers (instance_id, question_id);
