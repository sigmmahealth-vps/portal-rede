-- 0026_retention_certificate_verify.sql
-- Política de retenção para o action 'certificate_verify' (endpoint público
-- GET /api/certificados/verificar/:code, spec 5.4.5). É a única action sem
-- autenticação, alimentada por tráfego público via QR code — sem esta linha
-- em data_retention_policies o purgeExpiredLogs nunca expurga esses registros.

INSERT INTO data_retention_policies (action, ttl_days, description) VALUES
  ('certificate_verify', 90, 'Verificação pública de certificado por código (QR code, sem login)')
ON CONFLICT (action) DO NOTHING;
