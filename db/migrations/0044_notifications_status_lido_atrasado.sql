-- Mais status vindos do webhook do Resend: 'aberto' (email.opened → Lido) e
-- 'atrasado' (email.delivery_delayed). 'falhou' já existe (email.failed usa ele).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_email_status_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_email_status_check
  CHECK (email_status IN ('na','pendente','enviado','falhou','suprimido','entregue','rejeitado','reclamado','aberto','atrasado'));
