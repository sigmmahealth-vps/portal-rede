-- Termo de Ciência pelo Envio de Evidências, aceito por roteiro (spec 2026-09-29).
-- Registro definitivo: só INSERT, sem FK; guarda o texto integral aceito (term_text).
CREATE TABLE IF NOT EXISTS eval_instance_terms (
  id           bigserial PRIMARY KEY,
  instance_id  bigint      NOT NULL,
  user_id      bigint      NOT NULL,
  user_name    text,
  user_email   text,
  term_version text        NOT NULL,
  term_text    text        NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  ip_hash      text
);
CREATE INDEX IF NOT EXISTS eval_instance_terms_instance_idx ON eval_instance_terms (instance_id, accepted_at DESC);
