# Versionamento de roteiros por revisão — Design

**Data:** 2026-06-22
**Status:** Aprovado para planejamento
**Área:** Qualificação (Admin → "Roteiros de Avaliação")

## Problema

A coluna `eval_scripts.version` está **sobrecarregada** e cada caminho de criação
grava algo diferente nela:

- **Manual** (`POST /api/eval/scripts`): `version = '1.0'` fixo, sem `source_file`.
- **Upload web** (`POST /api/eval/scripts/import`): `version` = contador sequencial
  (`max+1` por `source_file`); a revisão da planilha vai para `revisao`.
- **CLI** (`db/import-roteiros.ts`): `version` = revisão da planilha; **apaga** a
  anterior (`DELETE WHERE source_file`).

Resultado: selos incoerentes (`v1`, `v00`, `v01`, `v1.0`), vigência calculada por
um inteiro que mistura esquemas, e ciclos de vida opostos (CLI apaga, web empilha).
Depois que passamos a ter `revisao`/`revisao_date` dedicadas, `version` ficou
redundante e inconsistente.

## Objetivo

Unificar o versionamento: **a versão de um roteiro É a revisão da planilha**.
Cada revisão é uma versão imutável que coexiste com as anteriores; a de **maior
número** é a vigente. Importação exclusivamente por Excel, com revisão, data de
revisão e data de implantação **obrigatórias** e **únicas por roteiro**.

## Decisões tomadas

| Tema | Decisão |
|------|---------|
| Identidade da versão | `version` passa a guardar **a revisão** da planilha (ex.: `"02"`) |
| Criação manual | **Removida** — import exclusivamente por `.xlsx` |
| Reset | **Apagar tudo** (`eval_scripts` + cascata, inclui avaliações preenchidas); usuário re-sobe pelo portal |
| Coluna redundante | **Dropar** `revisao` (= `version` agora) |
| Datas | `revisao_date` (existente) + **nova** `implantacao_date`; ambas `NOT NULL` |
| Vigência | Maior número de revisão por `source_file` (`is_current`) |
| Não sobrepor | Novas revisões **empilham** (nunca apagam as anteriores) |
| Unicidade | Por roteiro (`source_file`): revisão única **e** data de revisão única |
| Obrigatoriedade | Revisão, data de revisão e data de implantação são obrigatórias; faltando qualquer uma → import rejeitado |
| Conflito | Revisão **ou** data de revisão repetida → import rejeitado (rollback total) |

## Arquitetura

### 1. Banco — migration `db/migrations/0008_versionamento_revisao.sql`

Ordem operacional: **(1) wipe dos dados → (2) migration** (constraints sobre tabela
vazia, sem risco de violar dados legados).

```sql
-- Reset é passo operacional explícito (fora da migration): DELETE FROM eval_scripts;
ALTER TABLE eval_scripts ADD COLUMN IF NOT EXISTS implantacao_date date;
ALTER TABLE eval_scripts DROP COLUMN IF EXISTS revisao;            -- redundante: version É a revisão
ALTER TABLE eval_scripts ALTER COLUMN revisao_date SET NOT NULL;
ALTER TABLE eval_scripts ALTER COLUMN implantacao_date SET NOT NULL;
ALTER TABLE eval_scripts ADD CONSTRAINT eval_scripts_source_version_uq UNIQUE (source_file, version);
ALTER TABLE eval_scripts ADD CONSTRAINT eval_scripts_source_revdate_uq UNIQUE (source_file, revisao_date);
```

Observações:
- `version` continua `text` (guarda `"00"`, `"01"`, `"02"`).
- As constraints valem por `source_file`; especialidades diferentes podem ter
  revisão `"01"` cada.
- `NOT NULL` em `revisao_date`/`implantacao_date` é seguro porque o import passa a
  exigi-las e a base é zerada antes.

### 2. Parser — `db/roteiro-parser.ts`

A célula de metadados tem o formato:
`OPS-RED-FOR-001  Implantação: 01/04/2023  Revisão: 02 em 28/01/2026  Classificação: Interna`

- Já extrai `version` (revisão) e `revisaoDate`. **Adicionar** `implantacaoDate`:
  regex `/Implanta[çc][ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i` → ISO `YYYY-MM-DD`
  (`null` se ausente). Novo campo `implantacaoDate: string | null` em `ParsedScript`
  e nos dois `return`.
- O parser **não** rejeita (continua puro); a obrigatoriedade é validada no import
  (item 3), que tem o contexto de HTTP/erro.

### 3. Import — `server.ts` `POST /api/eval/scripts/import`

Dentro da transação, antes de inserir:

1. **Validar obrigatórios** (rejeita com `422` e mensagem específica, nada gravado):
   - revisão (`parsed.version`) ausente → *"A planilha não informa o número da revisão."* (ver nota sobre `"00"` abaixo)
   - `parsed.revisaoDate` nula → *"A planilha não informa a data da revisão."*
   - `parsed.implantacaoDate` nula → *"A planilha não informa a data de implantação."*
2. **Validar conflito** por `source_file` (rejeita com `409`, rollback total):
   - revisão já existe → *"Já existe uma versão com a revisão {NN} para este roteiro."*
   - data de revisão já existe → *"Já existe uma versão com a data de revisão {DD/MM/AAAA} para este roteiro."*
3. **Inserir** `version = parsed.version`, `revisao_date = parsed.revisaoDate`,
   `implantacao_date = parsed.implantacaoDate` (sem coluna `revisao`). As constraints
   do banco são a rede de segurança final.

Remove a lógica de contador (`nextVersion`). `scriptVersionNum` permanece **apenas**
para o cálculo de vigência.

Nota sobre `"00"`: hoje o parser usa fallback `'00'` quando não acha revisão. Como a
revisão passa a ser obrigatória, o parser retorna `null` (em vez de `'00'`) quando
ausente, e o import rejeita. Revisão legítima `"00"` (ex.: OPS-RED-FOR-024) continua
válida — distingue-se de "ausente" (`null`).

### 4. Preview — `server.ts` `POST /api/eval/scripts/preview` (UX)

O preview passa a **detectar e avisar antes de confirmar**: se a planilha não traz
os obrigatórios, ou se a revisão/data já existe para o roteiro, o preview retorna o
mesmo erro — o usuário vê o problema na prévia, sem precisar tentar importar.

### 5. Remoção da criação manual

- Remover o endpoint `POST /api/eval/scripts` (manual).
- Remover no `Admin.tsx` toda a UI de "montar manual": o estado `scriptForm`, o
  handler de criação manual e o formulário. "Novo Roteiro" oferece **apenas** o
  upload `.xlsx` (`ImportRoteiroModal`).

### 6. Reset dos dados (produção)

Passo operacional explícito e autorizado (como o backfill): `DELETE FROM eval_scripts`
(cascateia `eval_sections` → `eval_questions`, e `eval_instances` → `eval_answers`).
Executado **antes** da migration `0008`. O usuário re-sobe os roteiros pelo portal.

### 7. Frontend — selo único + histórico agrupado (`Admin.tsx`)

- **Selo único** por versão (substitui VersionBadge + RevisaoChip, que ficariam
  redundantes): "Revisão {version} · vigente" (verde) / "· substituída" (cinza),
  com "rev. {revisao_date}" e "implantação: {implantacao_date}" (pt-BR).
- **Agrupar por roteiro:** como cada especialidade passa a ter várias revisões,
  mostrar a **vigente** e um expansível *"ver revisões anteriores (N)"* listando as
  substituídas (revisão + datas). Evita a lista achatada com muitas linhas por
  especialidade. Vale nas visões cards e lista.
- Erros de import (obrigatórios/conflito) exibidos no `ImportRoteiroModal` de forma
  legível (não `alert` nativo).

## Tratamento de erros

| Situação | Comportamento |
|----------|---------------|
| Planilha sem nº de revisão | Import rejeitado (`422`), nada gravado |
| Planilha sem data de revisão | Import rejeitado (`422`), nada gravado |
| Planilha sem data de implantação | Import rejeitado (`422`), nada gravado |
| Revisão repetida (mesmo roteiro) | Import rejeitado (`409`, rollback) + bloqueio no banco |
| Data de revisão repetida (mesmo roteiro) | Import rejeitado (`409`, rollback) + bloqueio no banco |
| Revisão `"00"` legítima | Aceita (distinta de ausente) |

## Testes

- **Unit do parser** (`node:test`): extrai `implantacaoDate` (com data → ISO; sem →
  null); revisão ausente → `version` null (não `'00'`); revisão `"00"` legítima
  preservada.
- **Manual** (base = produção, após reset):
  1. Subir revisão `01` de um roteiro → aparece "Revisão 01 · vigente" + datas.
  2. Subir revisão `02` do mesmo → `02` vigente, `01` substituída (coexistem).
  3. Tentar subir `02` de novo → erro de revisão repetida, nada gravado.
  4. Tentar subir revisão nova com data de revisão já usada → erro de data repetida.
  5. Subir planilha sem data de implantação → rejeitado.
  6. Conferir o expansível "ver revisões anteriores".

## Riscos e observações

- **Destrutivo:** o reset apaga avaliações preenchidas em produção — autorizado pelo
  usuário (recomeço limpo). Push na `main` = deploy Railway; ambos exigem
  autorização explícita.
- **Ordem importa:** wipe **antes** da migration (constraints sobre tabela vazia) e
  antes de re-subir roteiros.
- **CLI `db:import-roteiros`:** sai do fluxo principal (import é pela web). Pode ser
  ajustado para o novo esquema num momento posterior ou marcado como legado; não é
  caminho de produção. (Decisão de implementação: alinhar `commitScript` ao novo
  INSERT ou removê-lo do escopo — tratada no plano.)
- **Dois "números" desaparecem:** com versão = revisão, some a confusão `v1`/`v01`.
