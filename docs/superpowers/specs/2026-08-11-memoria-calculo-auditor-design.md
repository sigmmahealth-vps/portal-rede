# Memória de cálculo detalhada por prestador (auditor)

**Data:** 2026-08-11
**Módulo:** Qualificação (5.4) — AuditorPlayer
**Público:** Auditor (interno). Fora de escopo: prestador, certificado, ANS/externo.

## Problema

O painel do auditor mostra a nota final e o selo, mas não **como** aquele número
foi formado: quanto cada critério contribuiu, o que saiu do cálculo (N/A aprovado,
sem resposta), os subtotais por dimensão, a base, o bônus da pesquisa e a faixa do
selo. Sem isso o auditor não consegue conferir nem justificar a nota.

## Objetivo

Um painel de **memória de cálculo** dentro do AuditorPlayer, que o auditor abre por
demanda, mostrando o cálculo **linha a linha por critério** com o rollup até a nota
e o selo. Atualiza conforme o auditor decide (aprova/reprova) e também serve para
revisar uma instância já fechada (read-only).

## Regra de cálculo (fonte única)

Hoje a regra vive inline no endpoint `POST /parecer` (`server.ts`), em SQL
(`COUNTS_IN_SCORE_SQL`) + JS. Para a memória bater **exatamente** com o parecer,
a regra é **extraída para uma função pura** reusada pelos dois.

### `src/lib/scoreMemory.ts` — `buildScoreMemory(rows, survey)`

**Entrada:**
- `rows`: um item por resposta existente (`eval_answers` ⨝ `eval_questions`):
  `{ question_id, code, dimension, is_eliminatory, max_score, answer_value, score_obtained, evidence_status }`.
- `survey`: `{ within_deadline: boolean } | null`.

**Classificação de cada critério:**
- `sem_resposta` → `answer_value` nulo/vazio. **Fora do cálculo.**
- `na_aprovado` → `answer_value = 'na'` **e** `evidence_status = 'aprovado'`. **Fora do cálculo.**
- caso contrário → **conta** no denominador, com `score_obtained / max_score`.
  (inclui N/A **reprovado**: conta como não conformidade, 0 ponto — regra D já vigente.)

**Consolidação de dimensão:** `Documento Legal` soma dentro de `Segurança`.

**Agregados (só sobre os que contam):**
- Por dimensão: `Σobtido`, `Σmáx`, `pct = Σobtido/Σmáx*100`.
- Totais: `obtido`, `max`, `base_pct = round(obtido/max*10000)/100` (2 casas).
- `bonus` = `10` se `survey.within_deadline`, senão `0` (null → 0, marcar "pendente").
- `final_pct = min(100, base_pct + bonus)`.
- `eliminatory_failed` = existe critério com `evidence_status='reprovado' AND is_eliminatory`.
- `seal` = `computeSeal(final_pct, eliminatory_failed)` (reusa `src/lib/computeSeal.ts`).

**Saída (`ScoreMemory`):**
```
{
  criteria: [{ question_id, code, dimension (consolidada), is_eliminatory,
               answer_value, evidence_status, obtained, max,
               classification: 'conta' | 'na_aprovado' | 'sem_resposta' }],
  dimensions: [{ dimension, obtained, max, pct }],
  out_of_calc: { na_aprovado: [...code], sem_resposta: [...code] },
  totals: { obtained, max, base_pct },
  bonus: number, bonus_pending: boolean,
  final_pct: number, eliminatory_failed: boolean, seal: string
}
```

### Convergência do `/parecer`

O `/parecer` passa a buscar as linhas por critério e chamar `buildScoreMemory`,
usando `totals`/`base_pct`/`bonus`/`final_pct`/`seal`/`eliminatory_failed` no lugar
do SQL `FILTER` + math inline. **Saída gravada deve ser idêntica** à atual — coberto
por teste de paridade (mesmos dados → mesmos `percentual`/`seal`). Remove duplicação:
a regra passa a existir só em `scoreMemory.ts`.

## Endpoint

`GET /api/eval/instances/:id/memoria-calculo` (staff-only, mesmo guard do painel).
- Busca `survey.within_deadline` (`eval_survey_responses`) e as linhas por critério.
- Retorna `buildScoreMemory(rows, survey)`.
- Para instância **fechada** (`aprovado/reprovado/finalizado/ciclo_encerrado`),
  inclui também `stored: { percentual, seal }` (valor oficial gravado) como headline;
  a UI sinaliza se houver divergência com o recomputado (não deve haver — fechada é
  read-only).

## UI

Botão **"Memória de cálculo"** no header do AuditorPlayer (ao lado de "Emitir
Parecer Final" / selo de leitura), abre um **modal/drawer** — mesmo padrão do
`PlanoAcaoModal` já existente. Componente próprio: `src/pages/qualificacao/MemoriaCalculoModal.tsx`
(AuditorPlayer já é grande; manter isolado).

Fetch ao abrir → sempre reflete as decisões atuais. Conteúdo:
- **Cabeçalho:** nota final + selo; se `eliminatory_failed`, bandeira vermelha
  "Reprovado em critério eliminatório". Para fechada, headline = `stored`.
- **Por dimensão** (Segurança[+DL] / Conforto / Experiência): tabela linha a linha
  (código, resposta, `obtido/máx`, flags eliminatório e "conta/fora") + subtotal `pct`.
- **Fora do cálculo:** listas de `na_aprovado` e `sem_resposta`, explicando o denominador.
- **Rodapé:** `base = Σobtido/Σmáx`, `bônus` (+10 no prazo, senão 0/"pendente"),
  `nota final` (teto 100), faixa do selo.

## Testes

- `scoreMemory.test.ts` — tabela-verdade: na-aprovado sai, na-reprovado conta 0,
  sem-resposta sai, consolidação DL→Segurança, base/bônus/teto, selo, eliminatório.
- Teste de **paridade do parecer**: para um conjunto de respostas, `buildScoreMemory`
  produz o mesmo `percentual`/`seal` que a fórmula atual.

## Fora de escopo (YAGNI)

Export PDF/planilha da memória, versão para o prestador, memória no certificado,
recalcular/reabrir instância fechada.
