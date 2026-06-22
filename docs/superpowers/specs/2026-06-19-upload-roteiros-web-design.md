# Upload de roteiros de qualificação pela web — Design

**Data:** 2026-06-19
**Status:** Aprovado para planejamento
**Área:** Qualificação (Admin → aba "Roteiros de Avaliação")

## Problema

Hoje só existe uma forma de cadastrar um roteiro de qualificação de alta
fidelidade (com seções aninhadas, pesos, evidência, dimensão, critérios
eliminatórios): rodar o CLI `tsx db/import-roteiros.ts --commit` no servidor,
que lê arquivos `.xlsx` do disco (`../rota-qualificacao`). Isso exige acesso ao
terminal e aos arquivos físicos — fora do alcance do gestor/admin.

A aba **Administração → "Roteiros de Avaliação"** (`src/pages/Admin.tsx`) já tem
um botão **"Novo Roteiro"**, mas ele abre um **montador manual** (digitar item a
item) que chama `POST /api/eval/scripts`. Esse caminho cria critérios
homogêneos de baixa fidelidade (todos `sim_nao`, peso 10, evidência obrigatória)
e não reflete os roteiros reais (OPS-RED-FOR-xxx).

## Objetivo

Permitir que admin/auditoria **suba um `.xlsx` de roteiro pela própria tela**,
veja uma **prévia** com o resultado do parse + avisos, e **confirme** a
importação — reusando o parser que já existe no CLI. Além disso, exibir na lista
de roteiros a **versão** (vigente/substituído) e um **status de ciclo de vida**
(rascunho/ativo/arquivado) controlável pelo admin.

## Escopo

Incluído:
- Upload de `.xlsx` de roteiro pela aba "Roteiros de Avaliação".
- Fluxo prévia → confirmar (não grava antes da confirmação).
- Versionamento por arquivo: nunca apaga; cada upload do mesmo roteiro cria nova
  versão.
- Status de ciclo de vida em `eval_scripts` + controle na UI.
- Manter o montador manual existente (o botão "Novo Roteiro" passa a oferecer as
  duas opções: subir `.xlsx` ou montar manualmente).
- Alternador de visualização da lista de roteiros: **cards** (atual) ou **lista**
  (tabela compacta).

Fora de escopo (YAGNI):
- Editar critério a critério um roteiro já existente.
- Configurar pela tela as faixas de selo (Ouro ≥90 / Prata ≥60 / Bronze) — segue
  hardcoded em `AuditorEvaluationModal.tsx`.
- Fila/processamento em background (o parse é síncrono e rápido).

## Decisões tomadas

| Tema | Decisão |
|------|---------|
| O que é "regra" | Roteiro completo via `.xlsx` |
| Fluxo de upload | Prévia e depois confirmar |
| Roteiro duplicado | Criar como **nova versão** (nunca apaga) |
| Onde fica | Aba existente Admin → "Roteiros de Avaliação" |
| Status na lista | Os dois: versão (vigente/substituído) + ciclo de vida (rascunho/ativo/arquivado) |
| Montador manual | Manter; "Novo Roteiro" oferece as duas vias |
| Visualização | Alternador cards / lista (preferência só na UI) |

## Arquitetura

### 1. Parser compartilhado — `db/roteiro-parser.ts` (novo)

Extrair de `db/import-roteiros.ts` a lógica pura de parse para um módulo
reutilizável, sem alterar o comportamento do CLI.

- Função nova exportada: `parseWorkbook(buffer: Buffer, sourceFile: string): ParsedScript`.
  - Hoje `parseFile(file)` faz `XLSX.readFile(file)`. A lógica passa a receber o
    workbook já lido (`XLSX.read(buffer, { type: 'buffer' })`), de modo que serve
    tanto para arquivo em disco (CLI) quanto para upload em memória (web).
- `import-roteiros.ts` passa a importar `parseWorkbook` (lê o arquivo do disco e
  delega). `commitScript` e o relatório `report` continuam no CLI.
- Tipos `ParsedScript`, `SectionNode`, `QuestionNode` movem para o módulo
  compartilhado (ou são reexportados dele) para uso no servidor.

**Nota de deploy (obrigatória):** mover `xlsx` de `devDependencies` para
`dependencies` em `package.json`. O servidor passará a usar `xlsx` em runtime; em
produção (Railway) `devDependencies` pode não ser instalada.

### 2. Backend — endpoints novos em `server.ts`

Multer já é dependência (usado no upload de evidência em
`POST /api/eval/instances/:id/evidence`). Reusar o mesmo padrão, em memória.

- **`POST /api/eval/scripts/preview`** (admin/auditoria; multipart, campo `file`)
  - Valida extensão `.xlsx` e mimetype; limite de tamanho (ex.: 5 MB).
  - `parseWorkbook(buffer, originalname)` → devolve relatório **sem gravar**:
    - `title`, `version` (revisão lida da planilha), `sourceFile`
    - contagem de seções e critérios, pontuação máxima total, mapa de dimensões
    - `warnings`: linhas não classificadas (`orphans`), critérios sem peso,
      critérios sem evidência, cabeçalho não encontrado
    - `existing`: se já há roteiro com aquele `source_file` — devolve a maior
      `version` atual e a `nextVersion` que será criada
    - `blocked`: `true` quando 0 critérios ou cabeçalho não reconhecido
- **`POST /api/eval/scripts/import`** (admin/auditoria; multipart, campo `file`)
  - Reparseia o arquivo (stateless; não confia em estado do preview).
  - Recusa com `422` se `blocked` (0 critérios / layout inválido).
  - Grava como **nova versão** dentro de `withTransaction`:
    - `version` = `(maior version existente para aquele source_file) + 1`,
      representada de forma consistente com o schema atual (texto). Para roteiros
      novos (sem source_file prévio), começa em `1`.
    - **Nunca** executa `DELETE` (diferente do CLI). Insere `eval_scripts` +
      `eval_sections` (respeitando `parent_section_id`) + `eval_questions`.
    - `status` do novo roteiro = `ativo` (default).
  - Retorna o `id` do roteiro criado e um resumo.
- **`PUT /api/eval/scripts/:id/status`** (admin/auditoria)
  - Body `{ status: 'rascunho' | 'ativo' | 'arquivado' }`, validado.
  - Atualiza `eval_scripts.status`.

Ajuste no **`GET /api/eval/scripts`** (já retorna `SELECT *` + `items`):
- Acrescentar o flag derivado `is_current` (vigente) — verdadeiro quando a linha
  tem a maior `version` para o seu `source_file`. Roteiros com `source_file` nulo
  (montados manualmente) são sempre `is_current = true`.
- `status` passa a vir automaticamente do `SELECT *` após a migration.

### 3. Banco — migration `db/migrations/0006_eval_script_status.sql` (nova)

```sql
ALTER TABLE eval_scripts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';
-- valores esperados: 'rascunho' | 'ativo' | 'arquivado'
```

- Não é preciso coluna para versão: `source_file` + `version` já existem
  (`0001_baseline.sql`). "Vigente/substituído" é derivado em consulta.
- Aplicar com `npm run db:migrate` (mesmo runner das migrations existentes).

### 4. Frontend — `src/pages/Admin.tsx` + componente novo

- **Botão "Novo Roteiro"** (já existe, aba `roteiros`): em vez de abrir direto o
  montador manual, abre um **seletor** com duas opções:
  - **"Subir planilha (.xlsx)"** → abre `ImportRoteiroModal` (novo).
  - **"Montar manualmente"** → abre o `showScriptModal` atual (sem mudanças).
- **`src/pages/qualificacao/ImportRoteiroModal.tsx`** (novo) — 3 estados:
  1. **Selecionar:** input `accept=".xlsx"`; envia para `/eval/scripts/preview`.
  2. **Revisar:** mostra o relatório (seções, critérios, pontuação, dimensões) e
     os **avisos em destaque**. Se `existing`, exibe "já existe a versão N; isto
     criará a versão N+1". Botão **Confirmar** desabilitado se `blocked`.
  3. **Confirmar:** envia para `/eval/scripts/import`; em sucesso, toast, fecha o
     modal e recarrega a lista (`loadData`).
- **Alternador de visualização** (cards / lista): dois botões/ícones no topo da
  aba. Estado `viewMode: 'cards' | 'lista'` em `Admin.tsx`, default `cards`.
  Persistir a preferência em `localStorage` (ex.: `roteirosViewMode`). É só UI —
  não muda dados nem endpoints; as duas visões consomem a mesma lista do
  `GET /eval/scripts`.
- **Conteúdo exibido nas duas visões** (mesmos campos):
  - título, nº de critérios (`script.items.length`),
  - **badge de versão**: "v{version} · vigente" ou "v{version} · substituído"
    (de `is_current`),
  - **badge de status** (rascunho/ativo/arquivado) com controle que chama
    `PUT /eval/scripts/:id/status`,
  - ação de excluir (já existe).
- **Visão cards:** o grid de cards atual, acrescido dos badges acima.
- **Visão lista:** tabela compacta (colunas: Roteiro, Versão, Critérios, Status,
  Ações) no mesmo padrão da tabela de prestadores/acessos já existente em
  `Admin.tsx`.

## Tratamento de erros

| Situação | Resposta |
|----------|----------|
| Arquivo não-`.xlsx` / corrompido | `400` com mensagem clara |
| Cabeçalho não reconhecido / 0 critérios | `preview` devolve `blocked: true`; `import` recusa com `422` |
| Papel sem permissão | `403` |
| Falha parcial na gravação | `withTransaction` desfaz tudo (atômico) |

## Testes

- **Unitário do parser** com `node:test` (nativo do Node 20, sem nova dependência):
  fixture `.xlsx` mínima → validar contagem de seções/critérios, pontuação total
  e que `parseWorkbook` produz o mesmo resultado do caminho antigo do CLI.
- **Plano de teste manual** (a base local aponta para o Postgres de **produção** —
  cuidado): subir um roteiro real → conferir prévia/avisos → confirmar → reabrir a
  lista e ver versão/status → arquivar e verificar o badge → subir o mesmo arquivo
  de novo e confirmar que criou v+1 sem apagar o anterior.

## Riscos e observações

- **Base de produção:** testar localmente grava no Postgres de produção. As provas
  manuais devem usar um roteiro de teste claramente identificável.
- **`xlsx` em runtime:** se a migração de `devDependencies` → `dependencies` for
  esquecida, o servidor quebra em produção ao importar o parser.
- **Versão lida da planilha vs. versão interna:** a "revisão" do `.xlsx` é
  informativa; a `version` gravada é o contador sequencial por `source_file`, para
  garantir ordenação de vigência mesmo que a revisão da planilha se repita.
- **Sem git:** o diretório não é repositório git; o commit do spec será pulado.
