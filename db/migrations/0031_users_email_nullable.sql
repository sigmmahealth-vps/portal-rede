-- 0031_users_email_nullable.sql
-- Prestador sem e-mail utilizável no cadastro também ganha usuário (tela Equipe):
-- email passa a aceitar NULL. Status "Sem e-mail" é derivado (email IS NULL) — o
-- admin define o e-mail pelo kebab e só então consegue enviar o convite. UNIQUE
-- permanece (Postgres trata NULLs como distintos). Login por e-mail nunca casa NULL.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
