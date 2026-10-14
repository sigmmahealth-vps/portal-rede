-- 0060_sgu_sync.sql — rotina diária SGU → cadastro (spec 2026-10-14, fase 2).
-- Tipo de endereço do SGU = chave estável da unidade (código <prestador>-<tipo>).
ALTER TABLE provider_locations ADD COLUMN IF NOT EXISTS sgu_tipo_endereco text;
-- Avaliação suspensa por prestador/unidade inativo no SGU guarda o status para restaurar.
ALTER TABLE eval_instances ADD COLUMN IF NOT EXISTS status_before_suspend text;
