-- 0026_remove_pesquisa_satisfacao.sql
-- A "pesquisa de satisfação da qualificação da rede" deixa de ser critério do
-- roteiro (passa a ser tratada só pelo módulo de Pesquisa). Remove o critério de
-- todos os eval_scripts já importados. A FK eval_answers.question_id ON DELETE
-- CASCADE remove as respostas, e eval_answer_iterations.answer_id (CASCADE) as
-- iterações — inclusive de avaliações abertas, que passam a pontuar sem o critério.
-- Avaliações finalizadas mantêm percentual/selo (congelados em eval_instances).

DELETE FROM eval_questions
 WHERE text ~* 'pesquisa de satisfa[çc][ãa]o da qualifica[çc][ãa]o da rede';
