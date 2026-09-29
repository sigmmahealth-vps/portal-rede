-- Aceite da Política de Privacidade (spec 2026-09-29). Registro definitivo: só INSERT,
-- sem FK para users (sobrevive à exclusão do usuário); nome/e-mail são o retrato do momento.
CREATE TABLE IF NOT EXISTS privacy_acceptances (
  id             bigserial PRIMARY KEY,
  user_id        bigint      NOT NULL,
  user_name      text,
  user_email     text,
  policy_version text        NOT NULL,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  ip_hash        text
);
CREATE INDEX IF NOT EXISTS privacy_acceptances_user_idx ON privacy_acceptances (user_id, accepted_at DESC);
