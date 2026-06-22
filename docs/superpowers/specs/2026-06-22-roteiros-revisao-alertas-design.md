# Roteiros: revisão, data da revisão e alertas na tela — Design

**Data:** 2026-06-22
**Status:** Aprovado para planejamento
**Área:** Qualificação (Admin → aba "Roteiros de Avaliação")

## Problema

A tela de roteiros (cards/lista em `src/pages/Admin.tsx`) mostra título, badge de
versão (contador sequencial), status e nº de critérios. Faltam três coisas que o
gestor precisa para julgar um roteiro sem reabrir a planilha:

1. **Revisão da planilha** (ex.: `02`) — hoje é extraída pelo parser mas
   **descartada** no import (a `version` gravada é o contador sequencial, não a
   revisão da planilha).
2. **Data da revisão** (ex.: `28/01/2026`) — existe na planilha mas o parser nem
   a lê.
3. **Alertas** (ex.: critérios sem evidência) — hoje só aparecem no modal de
   **preview do upload**; não há como inspecioná-los depois, no roteiro já salvo.

A célula de metadados (linha 0 da planilha) tem o formato:
`OPS-RED-FOR-001  Implantação: 01/04/2023  Revisão: 02 em 28/01/2026  Classificação: Interna`

## Objetivo

Na tela de roteiros, exibir a **revisão** e a **data da revisão** de cada roteiro,
e um **indicador de alertas** que, ao ser clicado, **expande um accordion inline**
listando os critérios sinalizados (código + texto). Os alertas são **recalculados
do banco**, funcionando imediatamente para os roteiros já existentes.

## Decisões tomadas

| Tema | Decisão |
|------|---------|
| Metadados exibidos | Revisão + data da revisão (apenas) |
| Origem dos alertas | Recalculados do banco (item-level): sem evidência, sem peso |
| Drill-down | Accordion inline (não modal) |
| Vigência | Inalterada; revisão da planilha é um chip distinto do badge de versão/vigência |

## Escopo

Incluído:
- Parsear a **data da revisão** (além do número, já parseado).
- Persistir revisão + data da revisão em `eval_scripts` (migration aditiva).
- Preencher os novos campos tanto no import web quanto no CLI (`commitScript`).
- Recalcular alertas item-level no `GET /api/eval/scripts` e devolvê-los inline.
- UI: chip de revisão/data + indicador de alertas + accordion com a lista de
  critérios sinalizados, nas visões cards e lista.

Fora de escopo (YAGNI):
- Órfãos / cabeçalho como alertas do roteiro salvo (são artefatos só do upload).
- Implantação / classificação (disponíveis na mesma célula, mas não pedidos).
- Edição de critério; qualquer mudança na lógica de vigência.

## Arquitetura

### 1. Parser — `db/roteiro-parser.ts`

A extração da revisão hoje usa `metaCell.match(/Revis[ãa]o:\s*(\d+)/i)`. Estender
para capturar também a data que vem após "em":

- Regex: `/Revis[ãa]o:\s*(\d+)\s+em\s+(\d{2})\/(\d{2})\/(\d{4})/i`.
- `version` (campo existente) continua sendo o número da revisão (ex.: `"02"`).
  Se a regex acima não casar, manter o fallback atual (`Revisão:\s*(\d+)` → ou
  `'00'`).
- Novo campo em `ParsedScript`: `revisaoDate: string | null` no formato ISO
  `YYYY-MM-DD` (convertido de `DD/MM/YYYY`). `null` quando não houver data.
- Sem mudança nas demais saídas do parser; teste unitário cobre os dois casos
  (com data → ISO; sem data → null).

### 2. Banco — migration `db/migrations/0007_eval_script_revisao.sql` (nova)

```sql
ALTER TABLE eval_scripts
  ADD COLUMN IF NOT EXISTS revisao      text,
  ADD COLUMN IF NOT EXISTS revisao_date date;
```

- Aditiva e idempotente, no padrão das migrations existentes.
- A `version` (contador sequencial) e a vigência derivada **não mudam**.
- Roteiros já existentes ficam com `revisao`/`revisao_date` nulos até serem
  **re-importados**. O CLI `db:import-roteiros` recria por `source_file`
  (idempotente), então re-rodá-lo faz o backfill.

### 3. Backend — `server.ts`

**Import web (`POST /api/eval/scripts/import`):** incluir `revisao` (= `parsed.version`)
e `revisao_date` (= `parsed.revisaoDate`) no INSERT de `eval_scripts`.

**CLI (`db/import-roteiros.ts`, `commitScript`):** incluir os mesmos dois campos no
seu INSERT de `eval_scripts`, para que re-importar pelo CLI preencha/backfille.

**`GET /api/eval/scripts`:** já retorna `SELECT *` (traz `revisao`/`revisao_date`
após a migration) + `items`. Acrescentar o cálculo de alertas por roteiro:

- A consulta de itens passa a trazer também `eq.code`, `eq.evidence_required`,
  `eq.max_score` (além do `eq.text as title` atual).
- Computar, reusando o helper já existente `isEvidenceExempt(text)`:
  - `semEvidencia`: itens com `evidence_required = false` **e** `!isEvidenceExempt(text)`
    → `[{ code, text }]`.
  - `semPeso`: itens com `max_score` nulo ou `0` → `[{ code, text }]`.
- Devolver por roteiro: `alerts: { semEvidencia: [...], semPeso: [...] }`. As listas
  são pequenas (após a isenção, normalmente 0–1), então vão inline sem custo
  relevante. Mantém-se o `items` atual (id/title) para a contagem do checklist.

### 4. Frontend — `src/pages/Admin.tsx` + componente novo

- **Chip de revisão:** ao lado do `VersionBadge`/`StatusControl`, um chip
  "Revisão {revisao} · {data}" (data formatada `DD/MM/YYYY`, pt-BR). Se `revisao`
  for nula (roteiro ainda não re-importado), o chip não aparece.
- **Indicador de alertas:** um botão/badge com ícone de alerta e a contagem total
  (`semEvidencia.length + semPeso.length`). Quando 0, indicador discreto ou oculto.
- **Accordion inline:** clicar no indicador expande/colapsa (estado local por
  roteiro) um painel logo abaixo, com seções "Sem evidência" e "Sem peso", cada
  uma listando os critérios sinalizados como `código — texto`
  (ex.: `1.1.1 — Dispõe de alvará de funcionamento válido...`). Seções vazias não
  aparecem.
- Novo componente `RoteiroAlerts` (recebe o objeto `alerts`), usado tanto na visão
  cards quanto na lista, para manter o `Admin.tsx` enxuto.

## Tratamento de erros

| Situação | Comportamento |
|----------|---------------|
| Planilha sem data de revisão | `revisaoDate = null`; chip mostra só "Revisão NN" (sem data) |
| Roteiro antigo sem `revisao` | Chip de revisão oculto; alertas seguem funcionando (recalculados) |
| Roteiro sem alertas | Indicador discreto/oculto; accordion não abre nada |

## Testes

- **Unitário do parser** (`node:test`): planilha com `Revisão: 02 em 28/01/2026`
  → `version = "02"`, `revisaoDate = "2026-01-28"`; planilha com só `Revisão: 03`
  → `revisaoDate = null`.
- **Manual** (base = produção; usar roteiro descartável `OPS-RED-FOR-999`):
  re-importar → ver chip de revisão/data; abrir o accordion e conferir os
  critérios "sem evidência" (incluindo a checagem de que a pesquisa de satisfação
  NÃO aparece, por estar isenta); excluir o roteiro de teste no fim.

## Riscos e observações

- **Backfill dos roteiros atuais:** revisão/data só aparecem após re-import. O
  caminho é re-rodar `npm run db:import-roteiros --commit` (recria por arquivo);
  decisão operacional do usuário (grava em produção).
- **Dois "números" na tela:** versão sequencial (vigência) + revisão da planilha.
  Mitigado exibindo-os como elementos visualmente distintos (badge vs chip
  rotulado "Revisão").
- **Base de produção / sem git no diretório-pai:** o app (`portal-rede-v1-main`)
  é repositório git; push na `main` dispara deploy (Railway). O `.env` local
  aponta para o Postgres de produção.
