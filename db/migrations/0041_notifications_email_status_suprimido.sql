-- Novo status de e-mail: 'suprimido' — e-mail que o mailer não enviou de verdade
-- (fora da EMAIL_ALLOWLIST na fase de testes, ou ConsoleMailer em dev/homolog).
-- Antes esses casos ficavam marcados como 'enviado' (falso-positivo) — a tela de
-- e-mails enviados precisa distinguir para não mentir ao auditor.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_email_status_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_email_status_check
  CHECK (email_status IN ('na','pendente','enviado','falhou','suprimido'));
