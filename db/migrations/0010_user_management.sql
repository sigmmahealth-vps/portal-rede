-- 0010_user_management.sql
-- Habilita cadastro de usuários administrativos pela UI + convite + recuperação de senha.

-- 1) users: password passa a aceitar NULL (usuário convidado fica sem senha até consumir o token).
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

-- 2) users: invite_status — 'pending' (convite ativo), 'accepted' (já definiu senha pelo menos uma vez), 'expired'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'accepted'
  CHECK (invite_status IN ('pending','accepted','expired'));

-- 3) users: last_login_at — atualizada em todo login bem-sucedido (após verify-otp).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 4) password_setup_tokens — tokens opacos de uso único pra convite e reset de senha.
CREATE TABLE IF NOT EXISTS password_setup_tokens (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash         TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('invite','reset')),
  expires_at         TIMESTAMPTZ NOT NULL,
  used_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pst_user_kind_used ON password_setup_tokens (user_id, kind, used_at);
CREATE INDEX IF NOT EXISTS idx_pst_expires        ON password_setup_tokens (expires_at);
