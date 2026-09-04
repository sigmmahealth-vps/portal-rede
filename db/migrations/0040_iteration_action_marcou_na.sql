-- Nova ação do auditor: marcar critério como "não se aplica" (marcou_na).
-- Amplia o CHECK da trilha de iterações para aceitar o novo valor.
ALTER TABLE eval_answer_iterations DROP CONSTRAINT IF EXISTS eval_answer_iterations_action_check;

ALTER TABLE eval_answer_iterations
  ADD CONSTRAINT eval_answer_iterations_action_check
  CHECK (action IN ('respondeu','solicitou_reanalise','aprovou','reprovou','marcou_na'));
