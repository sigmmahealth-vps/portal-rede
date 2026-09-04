-- Validade dos certificados passa a ser uma data escolhida na CRIAÇÃO do ciclo
-- (eval_cycles.cert_valid_until), obrigatória e travada assim que o ciclo é aberto.
-- Substitui a regra automática (end_date + 1 ano) que vivia em src/lib/certValidity.ts.
--
-- Backfill: ciclos existentes recebem end_date + 1 ano (a regra antiga aplicada uma
-- única vez) para que a coluna possa ser NOT NULL e ciclos já abertos sigam emitindo.
ALTER TABLE eval_cycles ADD COLUMN IF NOT EXISTS cert_valid_until date;

UPDATE eval_cycles
   SET cert_valid_until = (end_date + INTERVAL '1 year')::date
 WHERE cert_valid_until IS NULL;

ALTER TABLE eval_cycles ALTER COLUMN cert_valid_until SET NOT NULL;

ALTER TABLE eval_cycles
  ADD CONSTRAINT eval_cycles_cert_valid_until_after_end
  CHECK (cert_valid_until >= end_date);
