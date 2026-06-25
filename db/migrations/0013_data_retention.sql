-- 0013_data_retention.sql
-- Políticas de retenção por action de access_logs.
-- action = '__login__' representa os registros de login (action IS NULL na tabela).

CREATE TABLE IF NOT EXISTS data_retention_policies (
  action      TEXT PRIMARY KEY,
  ttl_days    INTEGER NOT NULL CHECK (ttl_days > 0),
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO data_retention_policies (action, ttl_days, description) VALUES
  ('__login__',                  180, 'Logs de login (sucesso e falha) — janela de segurança'),
  ('password_reset_requested',   365, 'Pedidos de recuperação de senha'),
  ('password_set',              1825, 'Definição/redefinição de senha (evento administrativo)'),
  ('user_invited',              1825, 'Criação/convite de usuário'),
  ('user_role_changed',         1825, 'Alteração de papel'),
  ('user_activated',            1825, 'Ativação de usuário'),
  ('user_deactivated',          1825, 'Desativação de usuário'),
  ('invite_resent',              365, 'Reenvio de convite')
ON CONFLICT (action) DO NOTHING;

-- Marca de última execução do expurgo (reutiliza tabela settings).
INSERT INTO settings (key, value) VALUES ('data_retention_last_run_at', '1970-01-01T00:00:00Z')
ON CONFLICT (key) DO NOTHING;
