# Dashboard de Qualificação (Estratégico) — Redesenho

**Data:** 2026-08-13
**Escopo:** Redesenho da aba **Estratégico** do módulo Qualificação (staff) — componente `GestorDashboard` + endpoint `/api/eval/dashboard`.

## Problema

O dashboard atual é fraco porque entrega números sem contexto nem ação:

- KPIs soltos (Total, Qualificados, Score Médio, Não Conformidades) sem meta, sem comparação, sem denominador.
- Não mostra **cobertura** da rede (quantos % já foram avaliados).
- `by_status` existe no dado mas vira só um subtítulo — não há **funil** que mostre o gargalo.
- "Não Conformidades: N" é cru — não diz **o quê** falha (dimensão/critério).
- Ranking mostra os **melhores**; o gestor age nos piores/em risco.
- **Planos de ação** e **engajamento na pesquisa** não aparecem.

## Objetivo

Um **centro de comando do ciclo** que serve três frentes (definidas com o usuário):
**Operar/cobrar andamento**, **Qualidade da rede** e **Cobertura**. Cada bloco abaixo é marcado com a(s) frente(s) que atende.

## Definições

- **Rede (denominador de cobertura):** **endereços comerciais de prestadores com roteiro atribuído** — `provider_locations` comerciais (exclui residencial: `label NOT ILIKE 'residencial%'` e `sgu_location_code !~ '-RES$'`) de `providers WHERE eval_script_id IS NOT NULL`. É o universo prestador/endereço que *deveria* ser avaliado.
- **Cobertura:** `endereços avaliados / rede`. Numerador = endereços distintos (`COUNT(DISTINCT location_id)`, não-nulo) com ≥1 `eval_instances` no escopo selecionado.
- **Qualificados** usa a mesma base: endereços distintos com selo / rede.
- **Concluído (avaliação):** `status IN ('aprovado','reprovado','finalizado')` (parecer emitido). `ciclo_encerrado` **não** conta. (mesma regra já usada em `[[portal-status-terminal-aprovado]]`.)
- **Não-conformidade:** `eval_answers.is_non_compliant = true`.
- Filtro de ciclo do topo (`?cycle_id=`, null = todos) continua valendo para todos os blocos.

## Layout (topo → base)

### ① Faixa de KPIs (5 cards)
- **Total de Avaliações** — `data.total` + subtítulo (finalizadas · pendentes · em N prestadores). **Mantido** do dashboard atual. [Operar]
- **Cobertura** — `endereços avaliados / rede (Y%)` + barra de progresso. [Cobertura]
- **Qualificados** — `endereços com selo / rede (Y%)` + **delta vs ciclo anterior** (▲/▼ pp, P2). [Qualidade]
- **Score médio** — `X%` + delta vs ciclo anterior (P2). [Qualidade]
- **Planos atrasados** — `N` (vermelho quando > 0). [Operar]

### ② Andamento do ciclo — funil [Operar]
Barras horizontais com contagem por estado, na ordem do fluxo:
Não iniciado (`pendente`) → Em preenchimento (`em_andamento`) → Em análise (`em_analise`) → Devolvido (`aguardando_evidencia`) → Concluído (`aprovado`/`reprovado`/`finalizado`).
Fonte: `by_status` (já existe). `ciclo_encerrado` fica fora do funil (é histórico).

### ③ Onde a rede falha [Qualidade]
- **Barras: taxa de não-conformidade por dimensão** (`não-conformes / respostas` por `eval_questions.dimension`; Documento Legal consolida em Segurança, como no certificado).
- **Lista: top critérios mais reprovados** (question_code + texto + nº de não-conformidades), top 5–8.
Substitui o card cru "Não Conformidades".

### ④ Precisam de atenção [Operar]
Lista acionável (substitui o "Top Prestadores"): prestadores **não qualificados** (concluído sem selo), **com plano atrasado**, ou **com avaliação aberta e prazo do ciclo vencendo**. Colunas: prestador · endereço · motivo · (link futuro p/ detalhe).
Opcional: um "Top 5" pequeno ao lado, para reconhecimento.

### ⑤ Engajamento na Pesquisa de Satisfação [Operar/Qualidade]
- **Taxa de resposta** `respondidas / disponíveis (Y%)` + barra.
- **No prazo** `% das respondidas dentro dos 7 dias`.
- **NPS** (de `q6_nps`) e/ou **CSAT** (média de `q5_geral`).
Reusa `src/lib/surveyStats.ts` / lógica do `PesquisaDashboard`.

### ⑥ Cobertura por município [Cobertura]
Barras por cidade: **avaliados vs total da rede** naquela cidade (cidade do prestador = sua unidade comercial principal). Alternativa mais barata: só avaliados + score médio por cidade.

### Mantidos (já bons)
- **Evolução do nível de conformidade** (linha, média por mês). [Qualidade]
- **Distribuição de selos** (pizza). [Qualidade]

## Mudanças no backend (`/api/eval/dashboard`)

Campos novos no JSON (todos respeitando `cycle_id`):
- `network_total` — `COUNT(*) FROM providers WHERE eval_script_id IS NOT NULL` (denominador; independente de ciclo).
- `by_dimension_nc` — `[{ dimension, nc, total, rate }]` (answers × questions, DL→Segurança).
- `top_nc_criteria` — `[{ question_code, question_text, count }]` (top N).
- `action_plans` — `{ open, overdue, concluded }` (reusa `computePlanStatus`/`planColor` sobre os planos do ciclo).
- `attention` — `[{ provider, location_label, reason }]` (não qualificado / plano atrasado / prazo vencendo).
- `survey_engagement` — `{ available, responded, response_rate, within_deadline_rate, nps, csat }`.
- `by_city` — `[{ cidade, uf, evaluated, network_total, avg_score }]`.
- `prev` — métricas do ciclo anterior para os deltas (`{ avg_score, qualified_pct }`), quando houver ciclo selecionado com um anterior.

`providers_evaluated`, `by_status`, `seal_distribution`, `evolution` já existem e continuam.

## Fora de escopo

- Outras abas (Painel do Ciclo, Ciclos, Plano de Ação, Pesquisa) — só cedem dados/KPIs.
- Exportação (o botão "Exportar Relatório" já foi removido).
- Drill-down navegável a partir dos blocos (links para outras telas) — futuro; por ora os blocos são informativos.

## Faseamento (para o plano)

- **P1 (núcleo, dado já existe):** funil ②, "onde a rede falha" ③, engajamento na pesquisa ⑤, KPIs ① sem deltas (cobertura + qualificados% + score + planos atrasados).
- **P2:** deltas vs ciclo anterior (`prev`), "precisam de atenção" ④, cobertura por município ⑥.

## Critérios de aceite (P1)

1. KPI de **Cobertura** mostra `endereços avaliados / network_total (%)` com `network_total = endereços comerciais de prestadores com eval_script_id`.
2. Funil ② mostra os 5 estados na ordem do fluxo, com contagem, sem `ciclo_encerrado`.
3. Bloco ③ mostra taxa de não-conformidade por dimensão e top critérios reprovados (some o card cru "Não Conformidades").
4. Bloco ⑤ mostra taxa de resposta da pesquisa + NPS/CSAT.
5. KPI "Planos atrasados" reflete planos do ciclo em status `atrasado`.
6. Todos os blocos respeitam o filtro de ciclo do topo.
