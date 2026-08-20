-- Critérios DL (Documento Legal) são eliminatórios: reprovação rebaixa o selo a
-- Bronze independentemente da pontuação (computeSeal). O parser passa a marcar
-- is_eliminatory no import; aqui o backfill dos roteiros já carregados.
UPDATE eval_questions
   SET is_eliminatory = TRUE
 WHERE dimension = 'Documento Legal'
   AND is_eliminatory IS DISTINCT FROM TRUE;
