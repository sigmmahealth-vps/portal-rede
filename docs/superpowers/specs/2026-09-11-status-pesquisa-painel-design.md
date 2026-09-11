# Status da pesquisa no Painel do Ciclo — design

**Data:** 2026-09-11
**Demanda do cliente:** "Criar um status de aguardando finalização da pesquisa e
pesquisa finalizada." Decisão do usuário: exibir no **Painel do Ciclo (auditor)**.

## Contexto

O parecer é bloqueado enquanto a Pesquisa de Satisfação não foi respondida e o prazo de
7 dias (`surveyDeadline`, spec 5.4.6) não venceu — mas nada sinaliza isso ao auditor.

## Decisões

- **Estado derivado, sem status novo no banco** (status real segue `em_analise` etc.).
- Lib pura `auditorDashboard.ts` ganha `surveyState(status, submitted_at,
  has_survey_response, now)`:
  - `'aguardando'` → status `em_analise`/`aguardando_evidencia`, sem resposta, dentro do
    prazo (`isWithinDeadline`) — parecer travado;
  - `'finalizada'` → com resposta (nos mesmos status);
  - `null` → demais casos (não enviada, terminal, prazo vencido sem resposta).
  `buildAuditorDashboard` recebe `now` injetável (default `new Date()`) e devolve
  `survey_state` por instância.
- Server: query do `/eval/dashboard/auditor` passa a trazer `ei.submitted_at` e
  `(esr.id IS NOT NULL) AS has_survey_response` (LEFT JOIN `eval_survey_responses`).
- UI (PainelDoCiclo): badge pequeno sob o pill de status — "Aguardando finalização da
  pesquisa" (azul) / "Pesquisa finalizada" (verde). Só sinalização; sem filtro novo.

## Verificação

TDD em `auditorDashboard.test.ts` (3 estados + prazo vencido); `npm run lint` + suíte;
sem migration.
