-- 0057_login_cpf_cnpj.sql
-- Login do prestador por CPF/CNPJ (spec 2026-10-06). Continua 1 acesso por unidade;
-- a senha é que passa a ser a mesma em todos os acessos do prestador, e o e-mail de
-- cada unidade é cadastrado pela própria unidade no primeiro acesso (2FA + avisos).

-- Senha provisória definida pelo admin: troca obrigatória no primeiro acesso.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Desafio OTP que também confirma o e-mail da unidade: o e-mail só é gravado em
-- users quando o código é validado. all_units = aplicar às demais unidades pendentes.
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS all_units boolean NOT NULL DEFAULT false;

-- O e-mail deixa de ser a chave de login do prestador: o mesmo responsável pode usar
-- um único e-mail em várias unidades. Segue único só para a equipe interna, que
-- continua entrando por e-mail.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_staff_email_uniq ON users (lower(email)) WHERE provider_id IS NULL;
