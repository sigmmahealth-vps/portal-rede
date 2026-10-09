-- 0058_eval_instances_submitted_on_behalf.sql
-- Roteiro enviado pelo administrador em nome do prestador (pedido 2026-10-09): não
-- gera Pesquisa de Satisfação — sem bônus e sem travar o parecer. Gravado no
-- primeiro envio, junto com submitted_at.
ALTER TABLE eval_instances ADD COLUMN IF NOT EXISTS submitted_on_behalf boolean NOT NULL DEFAULT false;

-- Envios feitos antes desta coluna: sem registro de quem enviou, vale quem respondeu
-- (admin no papel de prestador). Quem já respondeu a pesquisa mantém a pesquisa.
UPDATE eval_instances ei
   SET submitted_on_behalf = true
 WHERE ei.submitted_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM eval_survey_responses sr WHERE sr.instance_id = ei.id)
   AND EXISTS (
     SELECT 1 FROM eval_answer_iterations eai
       JOIN eval_answers ea ON ea.id = eai.answer_id
       JOIN users u ON u.id = eai.actor_id
      WHERE ea.instance_id = ei.id AND eai.actor_role = 'prestador' AND u.role = 'admin');
