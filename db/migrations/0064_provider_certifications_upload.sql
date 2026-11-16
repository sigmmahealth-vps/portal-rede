-- 0064_provider_certifications_upload.sql
-- Certificações autoinformadas: arquivo anexo + ciclo de validação (pendente/valido/reprovado).
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente';
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS uploaded_by bigint REFERENCES users(id);
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS upload_date timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_certifications_status_check') THEN
    ALTER TABLE provider_certifications
      ADD CONSTRAINT provider_certifications_status_check CHECK (status IN ('pendente','valido','reprovado'));
  END IF;
END $$;
