-- Remove a exigência de que a validade do certificado seja >= fim do ciclo.
-- Passa a aceitar qualquer data (a validade continua obrigatória e travada ao abrir).
ALTER TABLE eval_cycles DROP CONSTRAINT IF EXISTS eval_cycles_cert_valid_until_after_end;
