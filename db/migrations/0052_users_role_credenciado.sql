-- Renomeia a classe "PF não médico" (0049) para "credenciado", a pedido do cliente.
-- Mesma regra: PF cujo grupo não é MEDICOS COOPERADOS (ver db/provider-role.ts).

ALTER TABLE users DROP CONSTRAINT users_role_check;
UPDATE users SET role = 'credenciado' WHERE role = 'pf_nao_medico';
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('prestador','cooperado','credenciado','admin','auditoria'));
