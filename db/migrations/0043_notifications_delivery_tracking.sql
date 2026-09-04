-- Rastreio de entrega real via webhook do provedor (Resend): guarda o id da
-- mensagem no envio e permite status de entrega/rejeição/reclamação vindos do webhook.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS provider_message_id text;
CREATE INDEX IF NOT EXISTS notifications_provider_message_id_idx
  ON notifications (provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_email_status_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_email_status_check
  CHECK (email_status IN ('na','pendente','enviado','falhou','suprimido','entregue','rejeitado','reclamado'));
