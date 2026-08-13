-- 0029_backfill_action_plan_location.sql
-- Planos de ação criados sem unidade (location_id NULL) recebem a unidade
-- comercial do prestador quando ele tem EXATAMENTE uma (mesma regra do
-- eval_instances / da criação do plano). Prestadores com 0 ou >1 unidades
-- comerciais ficam como estão — ambíguo, precisa de escolha manual.

UPDATE eval_action_plans p
   SET location_id = sub.loc_id
  FROM (
    SELECT pl.provider_id, MIN(pl.id) AS loc_id
      FROM provider_locations pl
     WHERE COALESCE(pl.label,'') NOT ILIKE 'residencial%'
       AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'
     GROUP BY pl.provider_id
    HAVING COUNT(*) = 1
  ) sub
 WHERE p.location_id IS NULL
   AND p.provider_id = sub.provider_id;
