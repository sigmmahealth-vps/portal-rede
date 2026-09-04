-- Separa os dois tipos de "não enviado":
--   'ignorado'  = suprimido pela EMAIL_ALLOWLIST/ConsoleMailer (o portal decidiu não enviar).
--   'suprimido' = suprimido pelo Resend (email.suppressed — endereço na lista do provedor).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_email_status_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_email_status_check
  CHECK (email_status IN ('na','pendente','enviado','falhou','suprimido','entregue','rejeitado','reclamado','aberto','atrasado','ignorado'));
