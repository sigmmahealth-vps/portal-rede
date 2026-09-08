-- 0046_users_session_version.sql
-- Revogação de sessão no servidor. O JWT carrega a claim `sv` = users.session_version
-- e o middleware compara a cada request. Incrementar a coluna invalida todas as
-- sessões ativas do usuário (logout, definição/troca de senha).
-- Tokens emitidos antes desta migration (sem `sv`) passam a ser rejeitados: todos
-- os usuários fazem login de novo uma vez após o deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;
