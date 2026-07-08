-- 0016_provider_responsavel_tecnico.sql
-- Responsável Técnico passa a ser campo próprio do prestador
-- (antes era derivado de um contato da equipe com cargo "responsável").
ALTER TABLE providers ADD COLUMN IF NOT EXISTS responsavel_tecnico text;
