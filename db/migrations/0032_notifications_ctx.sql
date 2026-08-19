-- 0032_notifications_ctx.sql
-- Contexto do evento (jsonb) na notificação: permite à caixa de entrada do portal
-- renderizar o detalhe rico (mesmos blocos do e-mail — destaque, próximos passos).
-- Notificações antigas ficam com ctx NULL e caem no formato simples.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ctx jsonb;
