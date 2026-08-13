-- 0028_certificate_seen.sql
-- Certificado "novo" no mural da aba Início (spec 2026-08-13, estado #6).
-- first_viewed_at NULL = ainda não aberto pelo prestador (gera alerta positivo).
-- Preenchido na 1ª abertura; a partir daí o certificado some do mural.

ALTER TABLE eval_certificates ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz;

-- Backfill: certificados que já existem NÃO devem inundar o mural como "novos".
-- Marca todos os atuais como já vistos (visto = data de emissão).
UPDATE eval_certificates SET first_viewed_at = issued_at WHERE first_viewed_at IS NULL;
