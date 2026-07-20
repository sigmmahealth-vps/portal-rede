-- 0017_documents_question_id.sql
-- Múltiplos anexos por questão de qualificação: cada evidência é um row em `documents`
-- (type='qualificacao_evidencia'), agora com question_id para agrupar por pergunta.
-- Índice parcial só sobre as evidências (o resto de `documents` não é afetado).

ALTER TABLE documents ADD COLUMN IF NOT EXISTS question_id integer;

CREATE INDEX IF NOT EXISTS documents_qualificacao_evidencia_idx
  ON documents (reference_id, question_id)
  WHERE type = 'qualificacao_evidencia';
