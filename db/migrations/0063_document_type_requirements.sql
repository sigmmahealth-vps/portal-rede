-- 0063_document_type_requirements.sql
-- Matriz Legal: quais tipos de documento são obrigatórios por função de prestador.
-- Junção por presença — linha existe ⇒ obrigatório para aquela função.
CREATE TABLE IF NOT EXISTS document_type_requirements (
  type_id bigint NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  role    text   NOT NULL CHECK (role IN ('cooperado','credenciado','pf_nao_medico','prestador')),
  PRIMARY KEY (type_id, role)
);
