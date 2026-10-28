-- Prazo informado nos avisos de reanálise (pedido Unimed 27/10/2026): a auditoria
-- quer comunicar 30/11 aos prestadores sem antecipar o fim do ciclo (31/12), que
-- trava parecer/certificado. Só texto de notificação — não bloqueia nenhum envio.
-- NULL = avisos usam a data fim do ciclo, como antes.
ALTER TABLE eval_cycles ADD COLUMN IF NOT EXISTS reanalysis_notice_date date;
