-- 0038_eval_instances_backfill_cycle.sql
-- E-05: amarra a validade do certificado ao fim do ciclo (fim do ciclo + 1 ano).
--
-- Instâncias nasciam sem ciclo pelo caminho "prestador inicia avaliação" (server
-- POST /eval/instances), que agora seta o ciclo ativo na criação. Sem ciclo, a
-- validade caía no fallback (aprovação + 1 ano) — foi o que o teste E-05 apontou.
--
-- Passo 1: amarra as instâncias órfãs ao ciclo ativo (partial unique WHERE active
-- garante no máximo um). Sem ativo, mantém NULL e o fallback segue cobrindo.
UPDATE eval_instances
   SET cycle_id = (SELECT id FROM eval_cycles WHERE active = true)
 WHERE cycle_id IS NULL
   AND (SELECT id FROM eval_cycles WHERE active = true) IS NOT NULL;

-- Passo 2: recalcula a validade dos certificados JÁ emitidos pela regra canônica
-- (mesma fórmula da 0025): fim do ciclo + 1 ano; sem ciclo, issued_at + 1 ano.
-- Idempotente — os que já estavam certos não mudam.
UPDATE eval_certificates ec
   SET valid_until = (
     COALESCE(
       (SELECT c.end_date
          FROM eval_instances ei
          LEFT JOIN eval_cycles c ON c.id = ei.cycle_id
         WHERE ei.id = ec.instance_id),
       ec.issued_at::date
     ) + interval '1 year'
   )::date;
