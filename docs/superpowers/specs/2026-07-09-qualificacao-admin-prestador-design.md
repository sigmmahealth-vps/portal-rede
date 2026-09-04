# Qualificação (5.4.3) — Visões Admin e Prestador a 100%

Data: 2026-07-09
Módulo da spec: OPS-CTR-FOR-002 §5.4.3 — Roteiros de Qualificação
Escopo: apenas as visões **Admin (Gestor)** e **Prestador**. Auditor e Cooperado ficam para depois.

## Contexto

O motor de roteiros (`eval_scripts/sections/questions/instances/answers`) já existe e funciona:
import dos .xlsx com versionamento, preenchimento pelo prestador (`RoteiroPlayer`), instâncias,
respostas, evidência e dashboard. Esta rodada **não reconstrói nada** — corrige bugs reais no
preenchimento do prestador e substitui o mock do dashboard admin por dado real.

Fato decisivo: o import grava **todo critério como `type='sim_nao'`** (`server.ts:2683`) e o parser
não lê a coluna "Tipo" (S/DL/E/C). Logo, todo roteiro real hoje é **Sim/Não + evidência**. Os tipos
numérico/data/texto/múltipla-escolha da spec §5.4.3.3 **não existem nos dados** — construí-los agora
seria YAGNI. Ler o "Tipo" e produzir tipos de resposta reais fica **adiado** (ver §Adiado).

Consequência aceita: o **selo** só é atribuído no fluxo do auditor (adiado). Enquanto ele não existir,
o dashboard admin mostra números baixos/zerados **de verdade** — comportamento correto; o mock é que
fingia estar populado.

## Prestador — correções

Arquivos: `src/pages/qualificacao/RoteiroPlayer.tsx`, `PrestadorView.tsx`, `server.ts` (endpoints
`/api/eval/instances/:id/answers`, `/evidence`, `GET /:id`). Sem migration — `eval_answers` já tem
`provider_observation` e `evidence_url`.

### P1/P2 — "Não se aplica" correto
- Hoje N/A chama `handleAnswerChange(q.id, 'na', q.max_score)` (`RoteiroPlayer:440`) → dá pontuação
  máxima. **Errado.** N/A deve ser *Não Pontuado*: `score_obtained = 0`.
- No cálculo do percentual, critério N/A sai **do numerador e do denominador** (peso a considerar = 0),
  para não penalizar quem legitimamente não se aplica.
- N/A exige **justificativa obrigatória**. Reusa `provider_observation`. UI: ao marcar N/A, abre um
  textarea; o botão Finalizar/Próxima valida que N/A sem justificativa não passa.

### P3 — Evidência persistente (bug de dados)
- Hoje o upload grava só em `documents` (reference_id = instanceId) e, ao reabrir, o player carrega
  apenas `answer_value`/`score` (`RoteiroPlayer:104`) → a evidência anexada "some" da tela.
- Correção:
  - Frontend `handleFileUpload` envia também `question_id` no FormData.
  - Endpoint `POST /evidence` passa a fazer `UPDATE eval_answers SET evidence_url = $url WHERE
    instance_id = $i AND question_id = $q` (upsert do answer se ainda não existir). Mantém o insert em
    `documents` como está.
  - `GET /eval/instances/:id` já retorna `eval_answers.*`; o player passa a carregar `evidence_url` e
    `provider_observation` no estado `answers` (estender `RoteiroPlayer:102-108`).
- O upsert de `/answers` (`server.ts:2909`) **não** lista `evidence_url` no `SET`, então preserva a
  evidência ao salvar rascunho. Confirmar que continua assim.

### P4 — Observação por critério
- Campo de observação (textarea) por critério, gravado em `provider_observation`. Opcional em geral;
  **obrigatório quando N/A** (mesmo campo, mesma validação da P2).

### P5 — Obrigatórios e bloqueio de finalização
- Sinalização visual de critério **não respondido** (sem `answer_value`) e, para `evidence_required`
  (exceto N/A), **sem evidência**.
- "Finalizar Avaliação" bloqueia enquanto houver pendência, listando o que falta. "Salvar Rascunho"
  continua livre.

### Score — helper puro + teste
- Extrair o cálculo de `finishEvaluation` (`RoteiroPlayer:227-240`) para um helper puro
  `computeScore(questions, answers)` que devolve `{ score, maxPossible, percentual }`, aplicando a
  regra de N/A (exclui do denominador) e somando `score_obtained` real em vez de "só `sim`".
- 1 teste (padrão `*.test.ts` do projeto) cobrindo: sim pontua, não = 0, N/A fora do denominador,
  percentual correto.

## Admin (GestorDashboard) — dado real

Arquivos: `src/pages/qualificacao/GestorDashboard.tsx`, `server.ts` (`GET /api/eval/dashboard`).

### A6 — Estender `/api/eval/dashboard`
Adicionar ao retorno atual (`total`, `approved`, `avg_score`, `by_status`):
- `seal_distribution`: contagem por selo entre finalizados (`Ouro/Prata/Bronze` + `Não Qualificado`
  para finalizados sem selo).
- `non_conformities`: `COUNT(*)` de `eval_answers WHERE is_non_compliant = true`.
- `ranking`: top N (10) prestadores por `percentual` entre instâncias finalizadas — `provider`, `score`
  (percentual), `seal`.
- `evolution`: média mensal de `percentual` por `date_trunc('month', completed_at)` (finalizados).
- Mantém o guard de role (admin/auditoria) já existente.

### A1–A4 — Ligar a UI
- A1 card "Não Conformidades": `data.non_conformities` (remove o `12` fixo em `:144`).
- A2 linha "Evolução": `data.evolution` (remove mock Jan–Mai em `:155`). Renderiza o que houver.
- A3 pizza "Selos": `data.seal_distribution` (remove 10/30/20/40 em `:179`).
- A4 tabela "Ranking": `data.ranking` (remove as 3 linhas fake em `:226`). "Ver todos" pode continuar
  simples (sem paginação nesta rodada).

### A5 — Exportar Relatório → CSV do ranking
- Botão passa a exportar `data.ranking` em CSV client-side, seguindo o padrão de `Documentos.tsx:197`
  (montar linhas + `Blob` `text/csv` + link download). Nome: `ranking_qualificacao.csv`.

## Adiado (marcar no código com comentário `ponytail:` + registrar como pendência)
- **Parser lê "Tipo" (S/DL/E/C)** e produz tipos de resposta reais (numérico/data/texto/upload/DL).
  Marcar em `db/roteiro-parser.ts` e no insert de `server.ts:2683`.
- **Fluxo do auditor**: aprovar / não-pontuar / solicitar reanálise por critério (§5.4.3.5), incluindo
  o status por critério visível ao prestador (P6: A responder/Respondido/Reanálise/Aprovado/Não
  Pontuado) e a notificação/reabertura de reanálise (§5.4.3.4.3).
- **Parecer Final** (§5.4.3.6): resumo por dimensão, classificação automática, eliminatórios, certificado.
- **DL → Gestão Documental** e **Plano de Ação 5W2H**.
- **Pendências do ciclo anterior** (alerta de itens recorrentes).

## Fora de escopo
Auditor, Cooperado, e tudo listado em §Adiado.

## Critérios de aceite
- Prestador: N/A não pontua e exige justificativa; evidência anexada permanece após reabrir; observação
  gravada; Finalizar bloqueia com pendências; `computeScore` coberto por teste.
- Admin: os 4 blocos e os cards refletem `eval_instances`/`eval_answers` reais (podendo estar zerados);
  Exportar gera CSV do ranking. Nenhum dado hardcoded remanescente em `GestorDashboard.tsx`.
