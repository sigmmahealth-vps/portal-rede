# Qualificação Fatia 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o fluxo completo de qualificação — abertura automática do ciclo, análise por critério com histórico, classificação server-side (Ouro/Prata/Bronze com eliminatório), DL como parte de Segurança e bypass via cadastro.

**Architecture:** Migration única `0020` acrescenta 3 estruturas (`eval_cycle_groups`, `eval_answer_iterations`, coluna `eval_questions.document_type`) e 1 unique index em `eval_instances`. Lógica pesada em helpers puros (`computeSeal`, `mergeSecurityDL`, regras de `extractDocumentType`) testados sem DB. Endpoints em `server.ts` orquestram queries. Frontend refatora `AuditorEvaluationModal` inteiro, adiciona ações no `PainelDoCiclo`/`CiclosAdmin`, e reanálise no `PrestadorView`.

**Tech Stack:** TypeScript (ESM/NodeNext, imports com `.js`), Node via `tsx`, Postgres via `pg`/`db/db.ts`, Express (`server.ts`), React 18 + Tailwind + `lucide-react`, `xlsx` já dependência, testes `node:test` + `node:assert/strict`.

## Global Constraints

- **Ambientes**: dev primeiro. Homolog só na task final. NUNCA tocar prod.
- **TS imports**: sempre com `.js` suffix (ESM/NodeNext).
- **Testes**: `node --import tsx --test <arquivo>`. Cada novo test file registrado no script `test` do `package.json`.
- **RBAC**: endpoints do auditor usam `isStaff` (já em server.ts:3370). Endpoints do prestador usam `loadInstanceForWrite` (já em server.ts, verifica ownership).
- **Transações**: **sempre** `withTransaction(async client => …)` para operações multi-statement (nunca `query('BEGIN')` sobre pool — regra reforçada pela Fatia 0 task 2).
- **auditLog**: helper existente, meta padrão `{provider_id, instance_id, location_id, …}`.
- **N/A fora do denominador**: qualquer soma de score/max ignora `answer_value='NA'`.
- **Selo server-side**: `POST /parecer` calcula. `PUT /status` legado ignora `seal` do body (marca `ponytail:`).
- **Windows/PATH**: `node` fora do PATH — prefixar `export PATH="/c/Program Files/nodejs:$PATH"` no bash antes de `node`/`npm`/`npx`.
- **Commit style**: `feat(escopo): ...` | `fix(escopo): ...` | `chore(escopo): ...` | `docs(escopo): ...`, footer `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## File Structure

**Migration**
- Create: `db/migrations/0020_qualificacao_fatia1.sql`

**Backend — helpers puros e testes**
- Modify: `db/roteiro-parser.ts` — adiciona `extractDocumentType` + integra no `questions.push`.
- Modify: `db/roteiro-parser.test.ts` — casos para `extractDocumentType`.
- Create: `src/lib/computeSeal.ts` + `.test.ts`.
- Create: `src/lib/dimensionAgg.ts` + `.test.ts`.
- Modify: `package.json` — registra os 2 novos test files.

**Backend — endpoints**
- Modify: `server.ts` — adiciona:
  - `GET /api/eval/cycles/:id/abertura-preview`
  - `POST /api/eval/cycles/:id/abrir`
  - `POST /api/eval/answers/:id/aprovar`
  - `POST /api/eval/answers/:id/reprovar`
  - `POST /api/eval/answers/:id/solicitar-reanalise`
  - `POST /api/eval/instances/:id/submit`
  - `POST /api/eval/instances/:id/parecer`
  - Ajuste SQL do `GET /api/eval/dashboard/auditor` e `GET /api/eval/dashboard/auditor.xlsx` (agrupamento DL→Segurança).
  - Extensão do `PUT /api/eval/instances/:id/answers` para gravar `eval_answer_iterations`.
  - `PUT /api/eval/instances/:id/status` marcado `ponytail:` deprecated (ignora `seal` do body).

**Frontend**
- Create: `src/lib/statusLabels.ts`
- Modify: `src/pages/qualificacao/CiclosAdmin.tsx` — coluna Ações ganha botão "Abrir" + modal de preview.
- Create: `src/pages/qualificacao/AbrirCicloModal.tsx` (novo componente do preview).
- Rewrite: `src/pages/qualificacao/AuditorEvaluationModal.tsx` — refactor completo (3 ações por critério, histórico, parecer final).
- Modify: `src/pages/qualificacao/RoteiroPlayer.tsx` — orientação de reanálise + badge bypass DL.
- Modify: `src/pages/qualificacao/PrestadorView.tsx` — botão "Enviar para Análise".
- Modify: `src/pages/qualificacao/PainelDoCiclo.tsx` — usa `statusLabel()` (troca hardcodes).
- Modify: `src/pages/qualificacao/GestorDashboard.tsx` — usa `statusLabel()`.

**Reimport de roteiros**
- Task 2 roda `npm run db:import-roteiros -- --commit` em dev para popular `document_type` nos 15 roteiros já importados.

---

## Task 1: Migration 0020 (schema + backfill em dev)

**Files:**
- Create: `db/migrations/0020_qualificacao_fatia1.sql`

**Interfaces:**
- Consumes: schema atual (eval_cycles, eval_instances, eval_answers, eval_questions).
- Produces: tabela `eval_cycle_groups`, tabela `eval_answer_iterations`, coluna `eval_questions.document_type` nullable, unique index `eval_instances_cycle_puloc_uniq`.

- [ ] **Step 1: Criar a migration**

Arquivo `db/migrations/0020_qualificacao_fatia1.sql`:

```sql
-- 0020_qualificacao_fatia1.sql
-- 5.4.1/5.4.2 — Fatia 1: grupos por ciclo, iterações por critério, bypass DL.
-- Idempotente (IF NOT EXISTS em tudo). Sem backfill destrutivo.

-- 1. Vínculo grupo↔roteiro por ciclo (spec 5.4.2.1).
CREATE TABLE IF NOT EXISTS eval_cycle_groups (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cycle_id       bigint NOT NULL REFERENCES eval_cycles(id) ON DELETE CASCADE,
  provider_group text NOT NULL,
  script_id      bigint NOT NULL REFERENCES eval_scripts(id),
  UNIQUE (cycle_id, provider_group)
);
CREATE INDEX IF NOT EXISTS eval_cycle_groups_cycle_idx ON eval_cycle_groups (cycle_id);

-- 2. Unicidade (prestador, unidade) por ciclo — regra de negócio da spec 5.4.2.1.
--    COALESCE trata location_id NULL como 0 pra unique funcionar com prestador sem unidade.
CREATE UNIQUE INDEX IF NOT EXISTS eval_instances_cycle_puloc_uniq
  ON eval_instances (cycle_id, provider_id, COALESCE(location_id, 0));

-- 3. Coluna document_type para bypass DL (spec 5.4.2.3 observação).
ALTER TABLE eval_questions ADD COLUMN IF NOT EXISTS document_type text;
CREATE INDEX IF NOT EXISTS eval_questions_document_type_idx
  ON eval_questions (document_type) WHERE document_type IS NOT NULL;

-- 4. Histórico de iterações por critério (spec 5.4.1.2 etapa 4).
CREATE TABLE IF NOT EXISTS eval_answer_iterations (
  id                bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  answer_id         bigint NOT NULL REFERENCES eval_answers(id) ON DELETE CASCADE,
  iteration_number  int NOT NULL,
  actor_id          bigint REFERENCES users(id) ON DELETE SET NULL,
  actor_role        text NOT NULL CHECK (actor_role IN ('prestador','auditor')),
  action            text NOT NULL
                     CHECK (action IN ('respondeu','solicitou_reanalise','aprovou','reprovou')),
  answer_value      text,
  score_obtained    numeric(8,2),
  evidence_url      text,
  observation       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (answer_id, iteration_number)
);
CREATE INDEX IF NOT EXISTS eval_answer_iterations_answer_idx
  ON eval_answer_iterations (answer_id);
```

- [ ] **Step 2: Aplicar em dev**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
APP_ENV=dev npm run db:migrate
```

Expected: `+ aplicada: 0020_qualificacao_fatia1.sql`. Se já aplicada, `= já aplicada`.

- [ ] **Step 3: Verificar em dev**

Criar `_verify-0020.mjs` no root do projeto:

```javascript
import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_DEV });
await c.connect();
if (new URL(process.env.DATABASE_URL_DEV).hostname !== 'reseau.proxy.rlwy.net') {
  console.error('host errado'); process.exit(1);
}
console.log('eval_cycle_groups:', (await c.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='eval_cycle_groups' ORDER BY ordinal_position`
)).rows.map(r => r.column_name));
console.log('eval_answer_iterations:', (await c.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='eval_answer_iterations' ORDER BY ordinal_position`
)).rows.map(r => r.column_name));
console.log('document_type col existe?', (await c.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name='eval_questions' AND column_name='document_type'`
)).rows.length > 0);
console.log('unique index cycle_puloc:', (await c.query(
  `SELECT indexname FROM pg_indexes WHERE indexname='eval_instances_cycle_puloc_uniq'`
)).rows);
await c.end();
```

```bash
node _verify-0020.mjs
rm _verify-0020.mjs
```

Expected: as duas listas de colunas populadas, coluna `document_type` existe, unique index presente.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0020_qualificacao_fatia1.sql
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): migration 0020 — grupos/iterações/document_type

Adiciona eval_cycle_groups (vínculo grupo↔roteiro por ciclo),
eval_answer_iterations (histórico por critério), eval_questions.
document_type (bypass DL) e unique index (cycle, provider, location).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Parser — `extractDocumentType` + reimport

**Files:**
- Modify: `db/roteiro-parser.ts` — adiciona `extractDocumentType` + integra no `questions.push`.
- Modify: `db/roteiro-parser.test.ts` — casos novos.

**Interfaces:**
- Consumes: `text` e `guidance` de cada critério.
- Produces: `QuestionNode.documentType: string | null` — populado só quando `dimension === 'Documento Legal'` e alguma regra dá match.

- [ ] **Step 1: Adicionar os testes (falhando)**

Em `db/roteiro-parser.test.ts`, no final do arquivo, acrescentar:

```typescript
import { extractDocumentType } from './roteiro-parser.js';

test('extractDocumentType — reconhece cada label da spec 5.4.2.3', () => {
  const cases: Array<[string, string, string]> = [
    ['Dispõe de alvará sanitário válido? DL', '', 'Alvará Sanitário'],
    ['Alvará de funcionamento expedido pelo órgão competente DL', '', 'Alvará de Funcionamento'],
    ['Alvará do Corpo de Bombeiros / AVCB DL', 'Alvará ou protocolo dentro do prazo', 'Alvará Corpo de Bombeiros'],
    ['Cadastro Nacional Estabelecimento Saúde (CNES) DL', '', 'CNES'],
    ['Dispõe de Anotação de Responsabilidade Técnica DL', '', 'ART'],
    ['Programa de Gerenciamento de Resíduos de Serviços de Saúde - PGRSS DL', '', 'PGRSS'],
    ['Dispõe de PGR (Programa de Gerenciamento de Riscos) DL', '', 'PGR'],
    ['Dispõe de PCMSO DL', '', 'PCMSO'],
    ['Contrato Social atualizado DL', '', 'Contrato Social'],
    ['Registro de Qualificação de Especialista (RQE) DL', '', 'RQE'],
  ];
  for (const [text, guidance, expected] of cases) {
    assert.equal(extractDocumentType(text, guidance), expected, `falhou: "${text}"`);
  }
});

test('extractDocumentType — PGR não bate com PGRSS e vice-versa', () => {
  assert.equal(extractDocumentType('PGRSS aprovado', ''), 'PGRSS');
  assert.equal(extractDocumentType('PGR anual', ''), 'PGR');
});

test('extractDocumentType — sem match retorna null', () => {
  assert.equal(extractDocumentType('Critério qualquer sem palavra-chave', ''), null);
  assert.equal(extractDocumentType('Certificação genérica', ''), null);
});

test('parseWorkbook popula document_type apenas para critérios DL', () => {
  // Monta uma planilha mínima com 1 critério S e 1 DL
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Revisão: 03'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Dispõe de alvará sanitário válido? "DL"', 'Alvará dentro do prazo', '10', '10'],
    ['1.1.2 Realiza treinamento anual? "S"', 'Lista de presença', '10', '10'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-TESTE.xlsx');
  const dl = parsed.questions.find(q => q.code === '1.1.1');
  const s = parsed.questions.find(q => q.code === '1.1.2');
  assert.ok(dl && s);
  assert.equal(dl!.documentType, 'Alvará Sanitário');
  assert.equal(s!.documentType, null);
});
```

- [ ] **Step 2: Rodar teste — deve falhar (função não existe)**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --import tsx --test db/roteiro-parser.test.ts 2>&1 | tail -20
```

Expected: `Cannot find export 'extractDocumentType'` OU `q.documentType is undefined`.

- [ ] **Step 3: Implementar `extractDocumentType` + integrar no parser**

Em `db/roteiro-parser.ts`:

Adicionar após `extractLegislation` (linha ~41):

```typescript
/**
 * Extrai um "tipo de documento" normalizado a partir do texto do critério + guidance,
 * usado pelo bypass DL (spec 5.4.2.3). Só faz sentido quando dimension='Documento Legal';
 * o chamador é responsável por só usar o valor nesse caso.
 * Regras aplicadas em ordem — primeira match ganha. Retorna null se nenhuma bate.
 */
export function extractDocumentType(text: string, guidance: string | null | undefined): string | null {
  const haystack = `${text} ${guidance ?? ''}`;
  const H = haystack.toLowerCase();
  // ORDER MATTERS — mais específico antes do genérico (PGRSS antes de PGR).
  if (/alvar[áa]\s+sanit[áa]rio/.test(H)) return 'Alvará Sanitário';
  if (/alvar[áa]\s+de\s+funcionamento/.test(H)) return 'Alvará de Funcionamento';
  if (/corpo\s+de\s+bombeiros|\bavcb\b/.test(H)) return 'Alvará Corpo de Bombeiros';
  if (/\bcnes\b|cadastro\s+nacional\s+(de\s+)?estabelecimento/.test(H)) return 'CNES';
  if (/anota[çc][ãa]o\s+de\s+responsabilidade\s+t[ée]cnica|\bart\b/.test(H)) return 'ART';
  if (/\bpgrss\b|res[íi]duos\s+de\s+servi[çc]os\s+de\s+sa[úu]de/.test(H)) return 'PGRSS';
  if (/\bpgr\b/.test(H)) return 'PGR';
  if (/\bpcmso\b|controle\s+m[ée]dico\s+e\s+sa[úu]de\s+ocupacional/.test(H)) return 'PCMSO';
  if (/contrato\s+social/.test(H)) return 'Contrato Social';
  if (/\brqe\b|registro\s+de\s+qualifica[çc][ãa]o\s+de\s+especialista/.test(H)) return 'RQE';
  return null;
}
```

Modificar a interface `QuestionNode` (linha ~60), acrescentar campo:

```typescript
export interface QuestionNode {
  sectionTmp: number | null;
  code: string | null;
  text: string;
  guidance: string | null;
  dimension: string | null;
  documentType: string | null;   // <-- NOVO
  legislation: string | null;
  weight: number;
  maxScore: number;
  evidenceRequired: boolean;
  isEliminatory: boolean;
  order: number;
}
```

Modificar o `questions.push({...})` (linha ~193) para incluir:

```typescript
    questions.push({
      sectionTmp,
      code: code || null,
      text,
      guidance,
      dimension,
      documentType: dimension === 'Documento Legal' ? extractDocumentType(text, guidance) : null,
      legislation: extractLegislation(text),
      weight,
      maxScore,
      evidenceRequired: !!guidance,
      isEliminatory: /mandat[óo]ri|eliminat[óo]ri/i.test(a),
      order: nextOrder(orderBySection, sectionTmp),
    });
```

- [ ] **Step 4: Modificar `db/import-roteiros.ts` para gravar `document_type`**

Localizar o INSERT de `eval_questions` (procurar por `INSERT INTO eval_questions`). Adicionar a coluna `document_type` na lista e usar `q.documentType`. O statement deve virar algo como:

```typescript
await client.query(
  `INSERT INTO eval_questions (section_id, code, text, legislation, type, options, weight, max_score, dimension, document_type, evidence_required, is_eliminatory, order_index)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
  [sectionId, q.code, q.text, q.legislation, 'sim_nao', null, q.weight, q.maxScore, q.dimension, q.documentType, q.evidenceRequired, q.isEliminatory, q.order]
);
```

(A ordem exata das colunas deve espelhar o INSERT existente — só acrescentar `document_type` na posição correspondente a `q.documentType`. Se o INSERT usar upsert por `code + text`, preserve.)

Também fazer o mesmo ajuste no `server.ts` linha ~2844 (o handler `POST /api/eval/scripts/import` usa `q.dimension` na inserção — adicionar `q.documentType`).

- [ ] **Step 5: Rodar teste — deve passar**

```bash
node --import tsx --test db/roteiro-parser.test.ts 2>&1 | tail -10
```

Expected: `pass` sem `fail`.

- [ ] **Step 6: Rodar suíte completa**

```bash
npm test 2>&1 | tail -5
```

Expected: todos passando (95 + 4 novos = 99).

- [ ] **Step 7: Reimport dos roteiros em dev**

Import é idempotente (upsert por `code + text` dentro do script_id — verificar no `import-roteiros.ts`). Se não for idempotente, reimport pode duplicar — checar antes.

```bash
APP_ENV=dev npm run db:import-roteiros -- --commit 2>&1 | tail -20
```

Expected: log dos 15 roteiros atualizados, sem erro. `document_type` populado para critérios DL.

- [ ] **Step 8: Verificar em dev**

Criar `_verify-doctype.mjs`:

```javascript
import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_DEV });
await c.connect();
const r = await c.query(`
  SELECT document_type, COUNT(*)::int AS n
    FROM eval_questions WHERE dimension='Documento Legal'
   GROUP BY document_type ORDER BY n DESC
`);
console.table(r.rows);
await c.end();
```

```bash
node _verify-doctype.mjs
rm _verify-doctype.mjs
```

Expected: distribuição realista — Alvará Sanitário, CNES, ART, PGRSS etc. Se muitos `null`, revisar regras.

- [ ] **Step 9: Commit**

```bash
git add db/roteiro-parser.ts db/roteiro-parser.test.ts db/import-roteiros.ts server.ts
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): parser extrai document_type + integra no import

extractDocumentType() normaliza texto/guidance dos critérios DL em
labels (Alvará Sanitário, CNES, ART, PGRSS, PGR, PCMSO, Contrato
Social, RQE, Alvará de Funcionamento, Corpo de Bombeiros). Só
aplica quando dimension='Documento Legal'. Import grava a coluna.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Helpers puros — `computeSeal` + `mergeSecurityDL`

**Files:**
- Create: `src/lib/computeSeal.ts` + `src/lib/computeSeal.test.ts`
- Create: `src/lib/dimensionAgg.ts` + `src/lib/dimensionAgg.test.ts`
- Modify: `package.json` — 2 test files novos no `scripts.test`.

**Interfaces:**
- Produces:
  ```ts
  export type Seal = 'Ouro' | 'Prata' | 'Bronze';
  export function computeSeal(percentual: number, hasEliminatoryFailed: boolean): Seal;

  export interface DimTotals { dimension: string; score: number; max_possible: number; }
  export function mergeSecurityDL(rows: DimTotals[]): DimTotals[];
  ```

- [ ] **Step 1: Escrever teste `computeSeal.test.ts` (falhando)**

Arquivo `src/lib/computeSeal.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeal } from './computeSeal.js';

test('faixas exatas da spec 5.4.2.3', () => {
  assert.equal(computeSeal(100.00, false), 'Ouro');
  assert.equal(computeSeal(90.01, false),  'Ouro');
  assert.equal(computeSeal(90.00, false),  'Prata');
  assert.equal(computeSeal(60.01, false),  'Prata');
  assert.equal(computeSeal(60.00, false),  'Bronze');
  assert.equal(computeSeal(0.00,  false),  'Bronze');
});

test('eliminatório reprovado rebaixa a Bronze independente da nota', () => {
  assert.equal(computeSeal(95, true), 'Bronze');
  assert.equal(computeSeal(70, true), 'Bronze');
  assert.equal(computeSeal(30, true), 'Bronze');
});
```

- [ ] **Step 2: Rodar — RED**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --import tsx --test src/lib/computeSeal.test.ts
```

Expected: `Cannot find module './computeSeal.js'`.

- [ ] **Step 3: Implementar**

Arquivo `src/lib/computeSeal.ts`:

```typescript
export type Seal = 'Ouro' | 'Prata' | 'Bronze';

/**
 * Selo da qualificação (spec 5.4.2.3). Faixas exatas:
 *   Acima de 90,00% → Ouro     (sem eliminatório reprovado)
 *   De 60,01% a 90,00% → Prata (sem eliminatório reprovado)
 *   Até 60,00% → Bronze
 * Regra adicional: qualquer eliminatório reprovado rebaixa a Bronze.
 * A spec não define o que fazer quando percentual > 60% com eliminatório reprovado —
 * decisão de produto: rebaixa a Bronze (nota alta não compensa eliminatório).
 */
export function computeSeal(percentual: number, hasEliminatoryFailed: boolean): Seal {
  if (hasEliminatoryFailed) return 'Bronze';
  if (percentual > 90.00) return 'Ouro';
  if (percentual > 60.00) return 'Prata';
  return 'Bronze';
}
```

- [ ] **Step 4: Rodar — GREEN**

```bash
node --import tsx --test src/lib/computeSeal.test.ts
```

Expected: `pass 2`, `fail 0`.

- [ ] **Step 5: Escrever teste `dimensionAgg.test.ts` (falhando)**

Arquivo `src/lib/dimensionAgg.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSecurityDL, type DimTotals } from './dimensionAgg.js';

test('mergeSecurityDL soma DL na Segurança (score e max_possible)', () => {
  const r = mergeSecurityDL([
    { dimension: 'Segurança',        score: 40, max_possible: 50 },
    { dimension: 'Documento Legal',  score: 20, max_possible: 30 },
    { dimension: 'Conforto',         score: 10, max_possible: 20 },
  ]);
  const seg = r.find(x => x.dimension === 'Segurança');
  assert.equal(seg!.score, 60);
  assert.equal(seg!.max_possible, 80);
  assert.equal(r.find(x => x.dimension === 'Documento Legal'), undefined);
  assert.equal(r.find(x => x.dimension === 'Conforto')!.score, 10);
});

test('mergeSecurityDL cria linha Segurança se só houver DL', () => {
  const r = mergeSecurityDL([
    { dimension: 'Documento Legal', score: 20, max_possible: 30 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { dimension: 'Segurança', score: 20, max_possible: 30 });
});

test('mergeSecurityDL sem DL retorna lista intacta', () => {
  const rows = [
    { dimension: 'Segurança', score: 10, max_possible: 10 },
    { dimension: 'Conforto',  score: 5,  max_possible: 10 },
  ];
  assert.deepEqual(mergeSecurityDL(rows), rows);
});

test('mergeSecurityDL vazio retorna vazio', () => {
  assert.deepEqual(mergeSecurityDL([]), []);
});
```

- [ ] **Step 6: Rodar — RED**

```bash
node --import tsx --test src/lib/dimensionAgg.test.ts
```

Expected: `Cannot find module './dimensionAgg.js'`.

- [ ] **Step 7: Implementar**

Arquivo `src/lib/dimensionAgg.ts`:

```typescript
export interface DimTotals {
  dimension: string;
  score: number;
  max_possible: number;
}

/**
 * Consolida "Documento Legal" em "Segurança" (spec 5.4.2.3 observação):
 * DL faz parte da nota de Segurança, não é uma dimensão separada no relatório.
 * Somam-se `score` e `max_possible` das duas dimensões; percentual é derivado
 * quando o consumidor precisar (score/max_possible*100).
 */
export function mergeSecurityDL(rows: DimTotals[]): DimTotals[] {
  const dl = rows.find(r => r.dimension === 'Documento Legal');
  if (!dl) return rows;
  const seg = rows.find(r => r.dimension === 'Segurança');
  const others = rows.filter(r => r.dimension !== 'Documento Legal' && r.dimension !== 'Segurança');
  const merged: DimTotals = {
    dimension: 'Segurança',
    score: (seg?.score ?? 0) + dl.score,
    max_possible: (seg?.max_possible ?? 0) + dl.max_possible,
  };
  return [merged, ...others];
}
```

- [ ] **Step 8: Rodar — GREEN**

```bash
node --import tsx --test src/lib/dimensionAgg.test.ts
```

Expected: `pass 4`, `fail 0`.

- [ ] **Step 9: Registrar test files no `package.json`**

Editar `package.json` — no script `test`, acrescentar `src/lib/computeSeal.test.ts src/lib/dimensionAgg.test.ts` ao final da lista.

- [ ] **Step 10: Rodar suíte completa**

```bash
npm test 2>&1 | tail -5
```

Expected: todos passando (~105).

- [ ] **Step 11: Commit**

```bash
git add src/lib/computeSeal.ts src/lib/computeSeal.test.ts src/lib/dimensionAgg.ts src/lib/dimensionAgg.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): helpers puros computeSeal + mergeSecurityDL

computeSeal: faixas exatas da spec 5.4.2.3 com rebaixamento
a Bronze quando há eliminatório reprovado.
mergeSecurityDL: soma dimensão Documento Legal na Segurança
para relatórios/KPIs, preservando a distinção no schema.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Endpoints — Abertura de ciclo

**Files:**
- Modify: `server.ts` — inserir 2 endpoints após o `DELETE /api/eval/cycles/:id` (Fatia 0 task 2).

**Interfaces:**
- Consumes: `eval_cycles`, `providers`, `provider_locations`, `eval_scripts`, `eval_cycle_groups`, `eval_instances`, `eval_answers`, `eval_answer_iterations`, `eval_questions`, `documents`. Helpers: `withTransaction`, `isStaff`, `auditLog`, `hashClientIp`.
- Produces:
  - `GET /api/eval/cycles/:id/abertura-preview` → contagens do que seria criado + listas de excluídos.
  - `POST /api/eval/cycles/:id/abrir` → executa a criação (idempotente por guard `instances_count=0`).

- [ ] **Step 1: Adicionar rotas em `server.ts`**

Após o bloco DELETE de `/api/eval/cycles/:id`, inserir:

```typescript
  // ==========================================================================
  // Abertura de ciclo (spec 5.4.1.2 etapa 1 + 5.4.2.1)
  // ==========================================================================

  async function buildAperturaPreview(cycleId: number) {
    const { rows: cycleRows } = await query(
      'SELECT id, label FROM eval_cycles WHERE id = $1', [cycleId]
    );
    if (!cycleRows.length) return { notFound: true } as const;
    const cycle = cycleRows[0];

    // Grupos ambíguos: provider_group com mais de um eval_script_id distinct.
    const { rows: ambigRows } = await query(`
      SELECT provider_group
        FROM providers
       WHERE provider_group IS NOT NULL AND eval_script_id IS NOT NULL
       GROUP BY provider_group
      HAVING COUNT(DISTINCT eval_script_id) > 1
    `);
    const ambiguousGroups = ambigRows.map((r: any) => r.provider_group);

    // Prestadores sem grupo.
    const { rows: noGroup } = await query(`
      SELECT id, COALESCE(trade_name, name) AS name
        FROM providers WHERE provider_group IS NULL LIMIT 50
    `);

    // Grupos que serão criados (não-ambíguos, com script definido).
    const { rows: groups } = await query(`
      SELECT p.provider_group, MIN(p.eval_script_id)::bigint AS script_id, COUNT(*)::int AS providers
        FROM providers p
       WHERE p.provider_group IS NOT NULL AND p.eval_script_id IS NOT NULL
         AND p.provider_group <> ALL($1::text[])
       GROUP BY p.provider_group
    `, [ambiguousGroups.length ? ambiguousGroups : ['__none__']]);

    // Unidades no guia médico dos prestadores desses grupos.
    const groupList = groups.map((g: any) => g.provider_group);
    const { rows: instRows } = await query(`
      SELECT COUNT(*)::int AS n
        FROM provider_locations pl
        JOIN providers p ON p.id = pl.provider_id
       WHERE pl.in_medical_guide = true
         AND p.provider_group = ANY($1::text[])
    `, [groupList.length ? groupList : ['__none__']]);

    // DL bypass — quantos crítérios DL de todos os scripts têm document_type + doc válido do prestador.
    const { rows: bypassRows } = await query(`
      SELECT COUNT(*)::int AS n
        FROM providers p
        JOIN eval_scripts s ON s.id = p.eval_script_id
        JOIN eval_sections sc ON sc.script_id = s.id
        JOIN eval_questions eq ON eq.section_id = sc.id AND eq.document_type IS NOT NULL
        JOIN documents d ON d.provider_id = p.id AND d.type = eq.document_type
                        AND d.status = 'valido'
                        AND (d.expiry_date IS NULL OR d.expiry_date >= CURRENT_DATE)
       WHERE p.provider_group = ANY($1::text[])
    `, [groupList.length ? groupList : ['__none__']]);

    return {
      cycle: { id: Number(cycle.id), label: cycle.label },
      would_create: {
        groups: groups.length,
        instances: instRows[0].n,
        dl_bypass: bypassRows[0].n,
      },
      excluded: {
        providers_without_group: noGroup.map((r: any) => ({ id: Number(r.id), name: r.name })),
        groups_without_script_mapping: ambiguousGroups,
      },
    };
  }

  app.get('/api/eval/cycles/:id/abertura-preview', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const preview = await buildAperturaPreview(Number(req.params.id));
      if ('notFound' in preview) return res.status(404).json({ error: 'ciclo não encontrado' });
      res.json(preview);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/eval/cycles/:id/abrir', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);

      const { rows: cy } = await query(
        'SELECT id, label, active FROM eval_cycles WHERE id = $1', [cycleId]
      );
      if (!cy.length) return res.status(404).json({ error: 'ciclo não encontrado' });
      if (!cy[0].active) return res.status(400).json({ error: 'ciclo não está ativo' });
      const { rows: existInst } = await query(
        'SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]
      );
      if (existInst.length) return res.status(409).json({ error: 'ciclo já tem instâncias' });

      const created = await withTransaction(async (client) => {
        // 1. Popula eval_cycle_groups (pula ambíguos).
        const { rows: groups } = await client.query(`
          INSERT INTO eval_cycle_groups (cycle_id, provider_group, script_id)
          SELECT $1, p.provider_group, MIN(p.eval_script_id)::bigint
            FROM providers p
           WHERE p.provider_group IS NOT NULL AND p.eval_script_id IS NOT NULL
             AND p.provider_group NOT IN (
               SELECT provider_group FROM providers
                WHERE provider_group IS NOT NULL AND eval_script_id IS NOT NULL
                GROUP BY provider_group HAVING COUNT(DISTINCT eval_script_id) > 1
             )
           GROUP BY p.provider_group
          RETURNING id, provider_group, script_id
        `, [cycleId]);

        // 2. Cria eval_instances (1 por unidade no guia médico cujo grupo caiu no ciclo).
        const { rows: instances } = await client.query(`
          INSERT INTO eval_instances (script_id, provider_id, location_id, status, cycle_id, started_at)
          SELECT ecg.script_id, p.id, pl.id, 'pendente', $1, now()
            FROM provider_locations pl
            JOIN providers p ON p.id = pl.provider_id
            JOIN eval_cycle_groups ecg ON ecg.cycle_id = $1 AND ecg.provider_group = p.provider_group
           WHERE pl.in_medical_guide = true
          RETURNING id, provider_id, script_id
        `, [cycleId]);

        // 3. DL bypass em lote — para cada instância, cria answer 'aprovado' para os critérios DL
        //    que têm documento válido no cadastro do prestador.
        //    Uma passada de INSERT ... SELECT.
        const { rows: bypassAnswers } = await client.query(`
          INSERT INTO eval_answers (instance_id, question_id, answer_value, score_obtained,
                                    evidence_url, evidence_status, auditor_observation, is_non_compliant)
          SELECT ei.id, eq.id, 'sim', eq.max_score, d.file_url, 'aprovado',
                 'Aprovado via cadastro (DL bypass)', false
            FROM eval_instances ei
            JOIN eval_sections sc ON sc.script_id = ei.script_id
            JOIN eval_questions eq ON eq.section_id = sc.id AND eq.document_type IS NOT NULL
            JOIN LATERAL (
              SELECT file_url FROM documents
               WHERE provider_id = ei.provider_id AND type = eq.document_type
                 AND status = 'valido'
                 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
               ORDER BY issue_date DESC NULLS LAST LIMIT 1
            ) d ON true
           WHERE ei.cycle_id = $1
          RETURNING id, instance_id, question_id, score_obtained, evidence_url
        `, [cycleId]);

        // 3.1. Registra iteration 1 (action='aprovou', actor=sistema/NULL) para cada bypass.
        //      5 valores por linha (answer_id, answer_value, score, evidence_url, observation);
        //      iteration_number=1, actor_id=NULL, actor_role='auditor', action='aprovou' são literais.
        if (bypassAnswers.length) {
          const placeholders = bypassAnswers.map((_, i) => {
            const b = i * 5;
            return `($${b+1}, 1, NULL, 'auditor', 'aprovou', $${b+2}, $${b+3}, $${b+4}, $${b+5})`;
          }).join(',');
          const params: any[] = [];
          for (const a of bypassAnswers) {
            params.push(a.id, 'sim', a.score_obtained, a.evidence_url, 'Aprovado via cadastro (DL bypass)');
          }
          await client.query(
            `INSERT INTO eval_answer_iterations
             (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
             VALUES ${placeholders}`,
            params
          );
        }

        return { groups: groups.length, instances: instances.length, dl_bypass: bypassAnswers.length };
      });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_opened',
        meta: { cycle_id: cycleId, ...created },
        ip: hashClientIp(req),
      });

      res.json({ cycle_id: cycleId, created });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

Ajuste na query de bypass: a lista de placeholders foi calculada assumindo 5 valores por linha mas o texto tinha "7" — corrigir na hora de escrever. Cada tupla insere: answer_id, iteration_number(=1 literal), actor_id(=NULL literal), actor_role('auditor'), action('aprovou'), answer_value, score, evidence_url, observation. Como 3 dos 9 campos são literais, só 5 placeholders por linha; o texto de `placeholders` acima deve ficar `($${b+1}, 1, NULL, 'auditor', 'aprovou', $${b+2}, $${b+3}, $${b+4}, $${b+5})` com o multiplicador `i * 5` no `b`. Ajustar para bater.

- [ ] **Step 2: Smoke test manual em dev (controlador)**

Deixar o subagente marcar TODO; o controlador vai chamar o endpoint via curl (autenticado) ou script mjs após o server subir. Não é bloqueio para a task.

- [ ] **Step 3: Confirmar TS**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): endpoints de abertura de ciclo

GET /cycles/:id/abertura-preview mostra o que será criado
e o que fica de fora (grupos ambíguos, prestadores sem grupo).
POST /cycles/:id/abrir popula eval_cycle_groups, cria uma
instância por unidade no guia médico e aplica DL bypass em
lote, tudo em withTransaction. Guard idempotente por
instances_count=0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Endpoints — ações por critério (auditor)

**Files:**
- Modify: `server.ts` — 3 endpoints novos + helper.

**Interfaces:**
- Consumes: `eval_answers`, `eval_answer_iterations`, `eval_instances`, `isStaff`, `auditLog`, `withTransaction`.
- Produces:
  - `POST /api/eval/answers/:id/aprovar` body `{observation?}`
  - `POST /api/eval/answers/:id/reprovar` body `{observation}`
  - `POST /api/eval/answers/:id/solicitar-reanalise` body `{observation}`

- [ ] **Step 1: Adicionar helper + 3 rotas em `server.ts`**

Após os endpoints da Task 4 (ou próximo aos handlers de `/api/eval/instances/:id/status`), inserir:

```typescript
  // ==========================================================================
  // Ações do auditor por critério (spec 5.4.1.2 etapa 4)
  // ==========================================================================

  async function loadAnswerForAuditor(answerId: number) {
    const { rows } = await query(`
      SELECT ea.id, ea.instance_id, ea.question_id, ea.answer_value, ea.score_obtained,
             ea.evidence_url, ea.evidence_status,
             ei.status AS instance_status, ei.provider_id, ei.location_id
        FROM eval_answers ea
        JOIN eval_instances ei ON ei.id = ea.instance_id
       WHERE ea.id = $1
    `, [answerId]);
    return rows[0] || null;
  }

  async function nextIterationNumber(client: any, answerId: number) {
    const { rows } = await client.query(
      'SELECT COALESCE(MAX(iteration_number), 0) + 1 AS n FROM eval_answer_iterations WHERE answer_id = $1',
      [answerId]
    );
    return Number(rows[0].n);
  }

  async function auditorAction(
    req: any, res: any,
    action: 'aprovou' | 'reprovou' | 'solicitou_reanalise',
    observationRequired: boolean
  ) {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const answerId = Number(req.params.id);
      const observation = (req.body?.observation ?? '').trim();
      if (observationRequired && !observation) {
        return res.status(400).json({ error: 'observação obrigatória' });
      }
      const ans = await loadAnswerForAuditor(answerId);
      if (!ans) return res.status(404).json({ error: 'answer not found' });
      if (!['em_analise', 'aguardando_evidencia'].includes(ans.instance_status)) {
        return res.status(409).json({ error: `instância em status ${ans.instance_status}, não aceita ação` });
      }

      const newEvidenceStatus =
        action === 'aprovou' ? 'aprovado' :
        action === 'reprovou' ? 'reprovado' : 'aguardando_reanalise';
      const newScore =
        action === 'reprovou' ? 0 :
        action === 'aprovou'  ? Number(ans.score_obtained ?? 0) : Number(ans.score_obtained ?? 0);
      const isNonCompliant = action === 'reprovou';

      await withTransaction(async (client) => {
        await client.query(`
          UPDATE eval_answers
             SET evidence_status = $1,
                 score_obtained  = $2,
                 auditor_observation = $3,
                 is_non_compliant = $4
           WHERE id = $5
        `, [newEvidenceStatus, newScore, observation || null, isNonCompliant, answerId]);

        const n = await nextIterationNumber(client, answerId);
        await client.query(`
          INSERT INTO eval_answer_iterations
            (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
          VALUES ($1, $2, $3, 'auditor', $4, $5, $6, $7, $8)
        `, [answerId, n, req.user.id, action, ans.answer_value, newScore, ans.evidence_url, observation || null]);

        if (action === 'solicitou_reanalise' && ans.instance_status === 'em_analise') {
          await client.query(
            `UPDATE eval_instances SET status = 'aguardando_evidencia' WHERE id = $1`,
            [ans.instance_id]
          );
        }
      });

      await auditLog({
        query, userId: req.user.id, action: `answer_${action}`,
        meta: {
          provider_id: Number(ans.provider_id),
          instance_id: Number(ans.instance_id),
          location_id: ans.location_id ?? null,
          question_id: Number(ans.question_id),
        },
        ip: hashClientIp(req),
      });

      res.json({ success: true, evidence_status: newEvidenceStatus });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  app.post('/api/eval/answers/:id/aprovar',              authenticate, (req, res) => auditorAction(req, res, 'aprovou', false));
  app.post('/api/eval/answers/:id/reprovar',             authenticate, (req, res) => auditorAction(req, res, 'reprovou', true));
  app.post('/api/eval/answers/:id/solicitar-reanalise',  authenticate, (req, res) => auditorAction(req, res, 'solicitou_reanalise', true));
```

- [ ] **Step 2: TS check**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): 3 ações do auditor por critério (aprovar/reprovar/reanalise)

Cada ação atualiza eval_answers + grava eval_answer_iterations
com actor='auditor', action correspondente e snapshot da answer.
Reanálise transiciona instância em_analise → aguardando_evidencia.
Guard: só em em_analise ou aguardando_evidencia. Observação
obrigatória em reprovar e solicitar_reanalise.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Endpoint `POST /instances/:id/submit` (prestador)

**Files:**
- Modify: `server.ts` — 1 endpoint novo + extensão do `PUT /instances/:id/answers` para gravar iteration.

**Interfaces:**
- Consumes: `eval_instances`, `eval_answers`, `eval_questions`, `eval_answer_iterations`, `loadInstanceForWrite`, `auditLog`.
- Produces:
  - `POST /api/eval/instances/:id/submit` — transiciona `em_andamento` OR `aguardando_evidencia` → `em_analise`.
  - `PUT /api/eval/instances/:id/answers` (existente) — passa a gravar 1 iteration por answer alterada.

- [ ] **Step 1: Extender `PUT /api/eval/instances/:id/answers`**

Localizar o handler (server.ts:3134). Dentro do `withTransaction`, para cada `ans` do array, após o upsert, adicionar:

```typescript
          const { rows: [{ id: answerId }] } = await client.query(
            `SELECT id FROM eval_answers WHERE instance_id = $1 AND question_id = $2`,
            [instanceId, ans.question_id]
          );
          const { rows: [{ n }] } = await client.query(
            `SELECT COALESCE(MAX(iteration_number), 0) + 1 AS n FROM eval_answer_iterations WHERE answer_id = $1`,
            [answerId]
          );
          await client.query(`
            INSERT INTO eval_answer_iterations
              (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
            VALUES ($1, $2, $3, 'prestador', 'respondeu', $4, $5, NULL, $6)
          `, [answerId, n, req.user.id, ans.answer_value || null, ans.score_obtained || 0, ans.provider_observation || null]);
          // Reset evidence_status se estava aguardando reanálise
          await client.query(
            `UPDATE eval_answers SET evidence_status = 'pendente' WHERE id = $1 AND evidence_status = 'aguardando_reanalise'`,
            [answerId]
          );
```

- [ ] **Step 2: Adicionar rota `POST /submit`**

Após o handler acima:

```typescript
  app.post('/api/eval/instances/:id/submit', authenticate, async (req: any, res) => {
    try {
      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;
      if (!['em_andamento', 'aguardando_evidencia'].includes(instance.status)) {
        return res.status(409).json({ error: `status ${instance.status} não permite submit` });
      }

      // Completude: toda eval_questions do script precisa ter answer com answer_value não vazio.
      const { rows: missing } = await query(`
        SELECT eq.id
          FROM eval_questions eq
          JOIN eval_sections sc ON sc.id = eq.section_id
         WHERE sc.script_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM eval_answers ea
              WHERE ea.instance_id = $2 AND ea.question_id = eq.id
                AND ea.answer_value IS NOT NULL AND ea.answer_value <> ''
           )
      `, [instance.script_id, req.params.id]);
      if (missing.length) {
        return res.status(409).json({ error: 'critérios sem resposta', missing_question_ids: missing.map((r: any) => Number(r.id)) });
      }

      const { rows: pending } = await query(
        `SELECT id FROM eval_answers WHERE instance_id = $1 AND evidence_status = 'aguardando_reanalise'`,
        [req.params.id]
      );
      if (pending.length) {
        return res.status(409).json({ error: 'critérios aguardando reanálise', pending_answer_ids: pending.map((r: any) => Number(r.id)) });
      }

      await query(`UPDATE eval_instances SET status = 'em_analise' WHERE id = $1`, [req.params.id]);

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_submitted',
        meta: {
          provider_id: Number(instance.provider_id),
          instance_id: Number(req.params.id),
          location_id: instance.location_id ?? null,
        },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

Observação: `loadInstanceForWrite` deve retornar `script_id` — se não retornar, ajustar o helper para incluí-lo no SELECT.

- [ ] **Step 3: TS check**

```bash
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): endpoint POST /instances/:id/submit + iterations no answers

Prestador submete a instância — transição em_andamento ou
aguardando_evidencia → em_analise. Guarda: completude (todo
critério do roteiro tem answer com valor não vazio) e nenhum
critério aguardando_reanalise. PUT /answers passa a gravar 1
iteration ('respondeu', actor='prestador') por answer.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Endpoint `POST /instances/:id/parecer` (auditor)

**Files:**
- Modify: `server.ts` — 1 endpoint novo + `ponytail:` no PUT /status legado.

**Interfaces:**
- Consumes: `eval_answers`, `eval_questions`, `eval_instances`, `computeSeal` (Task 3), `isStaff`, `withTransaction`, `auditLog`.
- Produces: `POST /api/eval/instances/:id/parecer` → recalcula server-side + persiste + retorna `{status, percentual, seal, hasEliminatoryFailed}`.

- [ ] **Step 1: Adicionar rota**

Após os endpoints da Task 5, inserir:

```typescript
  app.post('/api/eval/instances/:id/parecer', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);

      const { rows: [inst] } = await query(`
        SELECT id, status, provider_id, location_id FROM eval_instances WHERE id = $1
      `, [id]);
      if (!inst) return res.status(404).json({ error: 'instance not found' });
      if (inst.status !== 'em_analise') {
        return res.status(409).json({ error: `status ${inst.status} não permite parecer` });
      }

      const { rows: pending } = await query(`
        SELECT id FROM eval_answers
         WHERE instance_id = $1 AND evidence_status NOT IN ('aprovado','reprovado')
      `, [id]);
      if (pending.length) {
        return res.status(409).json({ error: 'critérios sem decisão terminal', pending_answer_ids: pending.map((r: any) => Number(r.id)) });
      }

      const { rows: [totals] } = await query(`
        SELECT
          COALESCE(SUM(ea.score_obtained) FILTER (WHERE ea.answer_value <> 'NA'), 0)::numeric AS score,
          COALESCE(SUM(eq.max_score)      FILTER (WHERE ea.answer_value <> 'NA'), 0)::numeric AS max_possible,
          COALESCE(BOOL_OR(ea.evidence_status = 'reprovado' AND eq.is_eliminatory), false) AS elim_fail
        FROM eval_answers ea
        JOIN eval_questions eq ON eq.id = ea.question_id
        WHERE ea.instance_id = $1
      `, [id]);

      const score = Number(totals.score);
      const maxPossible = Number(totals.max_possible);
      const percentual = maxPossible > 0 ? Math.round((score / maxPossible) * 10000) / 100 : 0;
      const hasEliminatoryFailed = !!totals.elim_fail;

      const { computeSeal } = await import('./src/lib/computeSeal.js');
      const seal = computeSeal(percentual, hasEliminatoryFailed);

      await query(`
        UPDATE eval_instances
           SET status = 'aprovado',
               score = $1, max_possible_score = $2, percentual = $3, seal = $4,
               completed_at = now()
         WHERE id = $5
      `, [score, maxPossible, percentual, seal, id]);

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_finalized',
        meta: {
          provider_id: Number(inst.provider_id),
          instance_id: id,
          location_id: inst.location_id ?? null,
          seal, percentual, has_eliminatory_failed: hasEliminatoryFailed,
        },
        ip: hashClientIp(req),
      });

      res.json({ status: 'aprovado', percentual, seal, hasEliminatoryFailed });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: Marcar `PUT /status` legado (só comentário)**

Localizar `app.put('/api/eval/instances/:id/status', ...)` (server.ts:3180). Adicionar comentário logo antes do handler:

```typescript
  // ponytail: legado. O selo agora é calculado exclusivamente em POST /parecer.
  // O campo `seal` do body é ignorado. Mantido para compat com o AuditorEvaluationModal
  // antigo até a Task 11 refatorar.
  app.put('/api/eval/instances/:id/status', authenticate, async (req: any, res) => {
```

E dentro do handler, quando extrai o body, substituir a linha do UPDATE para não usar `seal` do body:

```typescript
      const { status, score, percentual, max_possible_score } = req.body;
      const now = new Date().toISOString();
      await query(`
        UPDATE eval_instances
        SET status = $1, score = $2, max_possible_score = $3, percentual = $4,
            completed_at = CASE WHEN $5 IN ('pendente', 'finalizado') THEN $6 ELSE completed_at END
        WHERE id = $7
      `, [status, score || 0, max_possible_score || 0, percentual || 0, status, now, req.params.id]);
```

(Remover o `seal` do UPDATE — o campo continua no schema, só não é sobrescrito por esse endpoint.)

- [ ] **Step 3: TS check**

```bash
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): endpoint POST /instances/:id/parecer

Auditor emite parecer final: guarda todas answers em estado
terminal, recalcula score/max/percentual server-side ignorando
answer_value='NA', detecta eliminatório reprovado, chama
computeSeal e persiste. PUT /status legado passa a ignorar
seal do body (marcador ponytail).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Ajuste SQL — DL→Segurança em dashboard + xlsx

**Files:**
- Modify: `server.ts` — 2 queries (`/api/eval/dashboard/auditor` e `/api/eval/dashboard/auditor.xlsx`).

**Interfaces:**
- Consumes: `mergeSecurityDL` conceito (aplicado direto no SQL).
- Produces: mesmo shape de resposta dos endpoints, mas "% Segurança" reflete Segurança+DL.

- [ ] **Step 1: Ajustar `GET /api/eval/dashboard/auditor`**

Localizar a query `dimPct` (server.ts perto de 3460 — a que calcula `pct` por dimensão). Trocar `eq.dimension` por `CASE`:

```typescript
      const { rows: dimPct } = await query(`
        SELECT ea.instance_id,
               CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
               (SUM(ea.score_obtained) / NULLIF(SUM(eq.max_score), 0)) * 100 AS pct
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE ei.cycle_id = $1
           AND (ea.answer_value IS NULL OR ea.answer_value <> 'NA')
           AND eq.dimension IS NOT NULL
         GROUP BY ea.instance_id,
                  CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END
      `, [cycle.id]);
```

- [ ] **Step 2: Ajustar `GET /api/eval/dashboard/auditor.xlsx`**

Localizar a query `dimRows` (mesmo padrão). Aplicar o mesmo `CASE`:

```typescript
      const { rows: dimRows } = await query(`
        SELECT ea.instance_id,
               CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
               ROUND((SUM(ea.score_obtained) / NULLIF(SUM(eq.max_score), 0)) * 100)::int AS pct
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE ei.cycle_id = $1
           AND (ea.answer_value IS NULL OR ea.answer_value <> 'NA')
           AND eq.dimension IS NOT NULL
         GROUP BY ea.instance_id,
                  CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END
      `, [cycle.id]);
```

- [ ] **Step 3: TS check + suíte**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npx tsc --noEmit 2>&1 | tail -3
npm test 2>&1 | tail -5
```

Expected: 0 erros TS + suíte 100% (helpers puros testados na Task 3 continuam passando; endpoints não têm test files).

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): SQL do dashboard + xlsx agrega DL em Segurança

Substituição de eq.dimension por CASE WHEN dim IN (Segurança,
Documento Legal) THEN Segurança consolida a nota conforme
spec 5.4.2.3. Zero mudança de shape na resposta — só o valor
de "% Segurança" cresce por incluir DL. Não há mais coluna
"% Doc. Legal" (nunca existiu no export).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `statusLabels.ts` + refactor de hardcodes

**Files:**
- Create: `src/lib/statusLabels.ts`
- Modify: `src/pages/qualificacao/PainelDoCiclo.tsx` — usa `statusLabel()`.
- Modify: `src/pages/qualificacao/GestorDashboard.tsx` — usa `statusLabel()` onde renderiza status.
- Modify: `src/pages/qualificacao/PrestadorView.tsx` — mesmo.

**Interfaces:**
- Produces: `statusLabel(status: string): string` — mapeamento canônico.

- [ ] **Step 1: Criar o módulo**

Arquivo `src/lib/statusLabels.ts`:

```typescript
/**
 * Rótulos de status conforme spec 5.4.2.2. Único mapa canônico.
 * Fallback: se um status desconhecido chegar, mostra a string original.
 */
export const STATUS_LABEL: Record<string, string> = {
  pendente:              'Pendente',
  em_andamento:          'Em Preenchimento',
  em_analise:            'Em Análise',
  aguardando_evidencia:  'Aguardando Reanálise',
  aprovado:              'Concluído — Aprovado',
  reprovado:             'Concluído — Aprovado',
  finalizado:            'Concluído — Aprovado',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}
```

- [ ] **Step 2: Trocar em `PainelDoCiclo.tsx`**

Localizar a linha da tabela que renderiza `i.status.replace(/_/g, ' ')`. Trocar por `statusLabel(i.status)`. Adicionar o import no topo:

```tsx
import { statusLabel } from '../../lib/statusLabels';
```

- [ ] **Step 3: Trocar em `GestorDashboard.tsx` e `PrestadorView.tsx`**

Fazer grep por `status.replace` e por labels hardcoded ("Em Andamento", "Pendente", "Aprovado" render diretos). Substituir por `statusLabel(...)`. Manter as cores/pill separadas — só o texto vem do helper.

- [ ] **Step 4: TS check**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/statusLabels.ts src/pages/qualificacao/PainelDoCiclo.tsx src/pages/qualificacao/GestorDashboard.tsx src/pages/qualificacao/PrestadorView.tsx
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): statusLabels canônico + refactor de hardcodes

Único mapa em src/lib/statusLabels.ts com os rótulos da spec
5.4.2.2 (Pendente / Em Preenchimento / Em Análise /
Aguardando Reanálise / Concluído — Aprovado). Substituídos
os hardcodes em PainelDoCiclo, GestorDashboard e PrestadorView.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: UI `CiclosAdmin` — botão Abrir + modal de preview

**Files:**
- Create: `src/pages/qualificacao/AbrirCicloModal.tsx`
- Modify: `src/pages/qualificacao/CiclosAdmin.tsx` — coluna Ações ganha botão.

**Interfaces:**
- Consumes: endpoints `GET /cycles/:id/abertura-preview` e `POST /cycles/:id/abrir`.
- Produces: modal de confirmação e fluxo de abertura.

- [ ] **Step 1: Criar `AbrirCicloModal.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, AlertTriangle } from 'lucide-react';

export default function AbrirCicloModal({ cycle, onClose, onDone }: { cycle: any; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setPreview(await fetchApi(`/eval/cycles/${cycle.id}/abertura-preview`)); }
      catch (e: any) { setErr(e.message || 'erro'); }
    })();
  }, [cycle.id]);

  const abrir = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetchApi(`/eval/cycles/${cycle.id}/abrir`, { method: 'POST' });
      alert(`Ciclo aberto: ${res.created.instances} instâncias, ${res.created.dl_bypass} DL bypass.`);
      onDone(); onClose();
    } catch (e: any) { setErr(e.message || 'erro'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="p-5 border-b flex justify-between items-center">
          <h3 className="text-lg font-bold">Abrir {cycle.label}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!preview && !err && <p className="text-gray-500">Carregando preview...</p>}
          {err && <p className="text-red-600 text-sm">{err}</p>}
          {preview && (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-emerald-50 rounded"><p className="text-2xl font-bold text-emerald-700">{preview.would_create.groups}</p><p className="text-xs text-gray-600">Grupos</p></div>
                <div className="p-3 bg-blue-50 rounded"><p className="text-2xl font-bold text-blue-700">{preview.would_create.instances}</p><p className="text-xs text-gray-600">Instâncias</p></div>
                <div className="p-3 bg-purple-50 rounded"><p className="text-2xl font-bold text-purple-700">{preview.would_create.dl_bypass}</p><p className="text-xs text-gray-600">DL bypass</p></div>
              </div>
              {preview.excluded.providers_without_group.length > 0 && (
                <div className="text-xs text-gray-600">
                  <strong>{preview.excluded.providers_without_group.length} prestadores sem grupo</strong> ficam de fora.
                </div>
              )}
              {preview.excluded.groups_without_script_mapping.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded flex gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Grupos ambíguos (roteiros distintos, não mapeados):</strong>
                    <ul className="mt-1 list-disc list-inside">
                      {preview.excluded.groups_without_script_mapping.map((g: string) => <li key={g}>{g}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="p-4 bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={abrir} disabled={busy || !preview} className="btn btn-primary">
            {busy ? 'Abrindo...' : 'Confirmar abertura'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modificar `CiclosAdmin.tsx`**

Adicionar botão "Abrir" na coluna Ações — habilitado quando `c.active && c.instances_count === 0`:

```tsx
import AbrirCicloModal from './AbrirCicloModal';
// ...
const [abrindo, setAbrindo] = useState<any>(null);
// ... na coluna Ações da linha, ao lado de Editar/Excluir:
{c.active && c.instances_count === 0 && (
  <button onClick={() => setAbrindo(c)} className="text-emerald-700 hover:text-emerald-900" title="Abrir ciclo">
    <Play className="w-4 h-4" />
  </button>
)}
// ...
{abrindo && <AbrirCicloModal cycle={abrindo} onClose={() => setAbrindo(null)} onDone={load} />}
```

Adicionar `Play` ao import de `lucide-react`.

- [ ] **Step 3: TS check**

```bash
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add src/pages/qualificacao/AbrirCicloModal.tsx src/pages/qualificacao/CiclosAdmin.tsx
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): botão Abrir Ciclo + modal de preview em CiclosAdmin

Botão só aparece em ciclos ativos sem instâncias. Modal chama
GET /abertura-preview, mostra contagens (grupos/instâncias/DL
bypass) + alerta amber para grupos ambíguos, e chama POST
/abrir na confirmação. Feedback via alert nativo.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `AuditorEvaluationModal` — refactor completo

**Files:**
- Rewrite: `src/pages/qualificacao/AuditorEvaluationModal.tsx`.

**Interfaces:**
- Consumes: endpoints `/api/eval/answers/:id/{aprovar,reprovar,solicitar-reanalise}`, `/api/eval/instances/:id/parecer`; helper `statusLabel`.
- Produces: modal com 3 ações por critério, histórico colapsável e botão "Emitir Parecer Final".

- [ ] **Step 1: Reescrever o arquivo**

Substituir todo o conteúdo de `src/pages/qualificacao/AuditorEvaluationModal.tsx`. Estrutura:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, Check, XCircle, RotateCcw, ChevronDown, ChevronUp, ShieldCheck, FileText } from 'lucide-react';
import { statusLabel } from '../../lib/statusLabels';

interface Answer {
  id: number; question_id: number;
  answer_value: string | null; score_obtained: number;
  evidence_url: string | null; evidence_status: string | null;
  auditor_observation: string | null; provider_observation: string | null;
  is_non_compliant: boolean;
}
interface Question {
  id: number; code: string | null; text: string; dimension: string | null;
  max_score: number; document_type: string | null;
}
interface Iteration {
  id: number; iteration_number: number; actor_role: string; action: string;
  answer_value: string | null; observation: string | null; evidence_url: string | null; created_at: string;
}

export default function AuditorEvaluationModal({ instanceId, onClose }: { instanceId: number; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [iterations, setIterations] = useState<Record<number, Iteration[]>>({});
  const [loading, setLoading] = useState(true);
  const [openHistory, setOpenHistory] = useState<Set<number>>(new Set());
  const [reasonPrompt, setReasonPrompt] = useState<{ answerId: number; action: 'reprovou' | 'solicitou_reanalise' } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const inst = await fetchApi(`/eval/instances/${instanceId}`);
      const script = await fetchApi(`/eval/scripts/${inst.script_id}`);
      setData({ ...inst, script });
      const map: Record<number, Answer> = {};
      (inst.answers || []).forEach((a: Answer) => { map[a.question_id] = a; });
      setAnswers(map);
      // Iterations: assume endpoint futuro; por ora, coleta de inst.answers se vier.
      const iters: Record<number, Iteration[]> = {};
      (inst.answers || []).forEach((a: any) => { iters[a.id] = a.iterations || []; });
      setIterations(iters);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [instanceId]);

  const act = async (answerId: number, action: 'aprovou' | 'reprovou' | 'solicitou_reanalise', observation?: string) => {
    setBusy(true);
    const path = action === 'aprovou' ? 'aprovar' : action === 'reprovou' ? 'reprovar' : 'solicitar-reanalise';
    try {
      await fetchApi(`/eval/answers/${answerId}/${path}`, {
        method: 'POST', body: JSON.stringify({ observation: observation || '' }),
      });
      await load();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); setReasonPrompt(null); setReasonText(''); }
  };

  const emitirParecer = async () => {
    if (!confirm('Emitir parecer final? Esta ação fecha a avaliação.')) return;
    setBusy(true);
    try {
      const res = await fetchApi(`/eval/instances/${instanceId}/parecer`, { method: 'POST' });
      alert(`Parecer emitido: ${res.seal} (${res.percentual.toFixed(2)}%)`);
      onClose();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  const summary = useMemo(() => {
    const qs: Question[] = data?.script?.questions || [];
    let aprovados = 0, reprovados = 0, reanalise = 0, sem = 0;
    for (const q of qs) {
      const a = answers[q.id];
      if (!a) { sem++; continue; }
      if (a.evidence_status === 'aprovado') aprovados++;
      else if (a.evidence_status === 'reprovado') reprovados++;
      else if (a.evidence_status === 'aguardando_reanalise') reanalise++;
      else sem++;
    }
    return { aprovados, reprovados, reanalise, sem, canFinish: reanalise === 0 && sem === 0 };
  }, [data, answers]);

  if (loading || !data) {
    return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"><p className="text-white">Carregando...</p></div>;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex justify-center p-4 backdrop-blur-sm">
      <div className="bg-gray-50 w-full max-w-5xl flex flex-col rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-white px-6 py-4 border-b flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">Auditoria: {data.provider_name}</h2>
            <p className="text-sm text-gray-500">{data.script.title} · {statusLabel(data.status)}</p>
          </div>
          <button onClick={onClose}><X className="w-6 h-6 text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {data.script.questions.map((q: Question) => {
            const a = answers[q.id];
            if (!a) return null;
            const bypass = (a.auditor_observation || '').includes('Aprovado via cadastro');
            const iters = iterations[a.id] || [];
            const historyOpen = openHistory.has(a.id);
            const terminal = a.evidence_status === 'aprovado' || a.evidence_status === 'reprovado';
            return (
              <div key={q.id} className="bg-white p-4 border rounded-xl">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-mono text-gray-500">{q.code} · {q.dimension}</p>
                    <p className="font-semibold text-sm mt-1">{q.text}</p>
                    <p className="text-sm mt-2">Resposta: <strong>{a.answer_value || '—'}</strong></p>
                    {a.evidence_url && <a href={a.evidence_url} target="_blank" className="text-sm text-blue-600 underline flex items-center gap-1 mt-1"><FileText className="w-3 h-3" /> Evidência</a>}
                    {a.provider_observation && <p className="text-xs text-gray-600 italic mt-1">"{a.provider_observation}"</p>}
                    {bypass && <span className="inline-block mt-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded">Atendido via cadastro</span>}
                    {a.evidence_status && <span className={`inline-block mt-2 ml-2 px-2 py-0.5 text-xs font-bold rounded ${
                      a.evidence_status === 'aprovado' ? 'bg-emerald-100 text-emerald-800' :
                      a.evidence_status === 'reprovado' ? 'bg-red-100 text-red-800' :
                      a.evidence_status === 'aguardando_reanalise' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100'
                    }`}>{a.evidence_status.replace('_', ' ')}</span>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button disabled={busy || terminal} onClick={() => act(a.id, 'aprovou')} className="px-3 py-1.5 text-xs bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 disabled:opacity-40 flex items-center gap-1"><Check className="w-3 h-3" /> Aprovar</button>
                  <button disabled={busy || terminal} onClick={() => { setReasonPrompt({ answerId: a.id, action: 'reprovou' }); setReasonText(''); }} className="px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 disabled:opacity-40 flex items-center gap-1"><XCircle className="w-3 h-3" /> Reprovar</button>
                  <button disabled={busy || terminal} onClick={() => { setReasonPrompt({ answerId: a.id, action: 'solicitou_reanalise' }); setReasonText(''); }} className="px-3 py-1.5 text-xs bg-orange-50 text-orange-700 rounded hover:bg-orange-100 disabled:opacity-40 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Reanálise</button>
                  {iters.length > 0 && (
                    <button onClick={() => setOpenHistory(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} className="ml-auto text-xs text-gray-600 flex items-center gap-1">
                      {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Histórico ({iters.length})
                    </button>
                  )}
                </div>
                {reasonPrompt?.answerId === a.id && (
                  <div className="mt-3 p-3 bg-gray-100 rounded">
                    <textarea value={reasonText} onChange={e => setReasonText(e.target.value)} placeholder="Justificativa obrigatória..." className="w-full p-2 border rounded text-sm" rows={2} />
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => setReasonPrompt(null)} className="text-xs px-3 py-1 border rounded">Cancelar</button>
                      <button disabled={!reasonText.trim()} onClick={() => act(a.id, reasonPrompt.action, reasonText)} className="text-xs px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-40">Confirmar</button>
                    </div>
                  </div>
                )}
                {historyOpen && (
                  <div className="mt-3 pl-4 border-l-2 border-gray-200 space-y-2">
                    {iters.map(it => (
                      <div key={it.id} className="text-xs text-gray-700">
                        <span className="font-semibold">#{it.iteration_number} · {it.actor_role} · {it.action}</span>
                        <span className="text-gray-500"> ({new Date(it.created_at).toLocaleString('pt-BR')})</span>
                        {it.observation && <p className="italic text-gray-600">"{it.observation}"</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-white border-t px-6 py-4 flex justify-between items-center">
          <div className="text-sm">
            <span className="text-emerald-700 font-semibold">{summary.aprovados} ✓</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-red-700 font-semibold">{summary.reprovados} ✗</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-orange-700 font-semibold">{summary.reanalise} 🔁</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-gray-600 font-semibold">{summary.sem} sem análise</span>
          </div>
          <button onClick={emitirParecer} disabled={busy || !summary.canFinish} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded disabled:opacity-50 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Emitir Parecer Final
          </button>
        </div>
      </div>
    </div>
  );
}
```

Nota: o payload de iterações depende do `GET /eval/instances/:id` retornar `answers[i].iterations`. Se hoje não retorna, o modal renderiza sem histórico (array vazio) — o histórico só aparecerá quando o backend for estendido. Este ajuste é `ponytail:` pra fatia futura, mas o botão de expandir só aparece com `iters.length > 0`, então é inofensivo.

- [ ] **Step 2: TS check**

```bash
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add src/pages/qualificacao/AuditorEvaluationModal.tsx
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): AuditorEvaluationModal refatorado

3 ações por critério (Aprovar / Reprovar / Reanálise) com
prompt inline de justificativa obrigatória em Reprovar/
Reanálise. Sumário live no rodapé. Botão "Emitir Parecer
Final" habilitado quando todos critérios em estado terminal.
Badge "Atendido via cadastro" para bypass DL. Histórico
colapsável por critério (renderiza se backend enviar).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: UI `PrestadorView`/`RoteiroPlayer` — reanálise + submit

**Files:**
- Modify: `src/pages/qualificacao/RoteiroPlayer.tsx` — faixa amber com orientação + badge bypass DL.
- Modify: `src/pages/qualificacao/PrestadorView.tsx` — botão "Enviar para Análise".

**Interfaces:**
- Consumes: `POST /api/eval/instances/:id/submit`.
- Produces: fluxo de resposta em modo reanálise + submit.

- [ ] **Step 1: Modificar `RoteiroPlayer.tsx`**

Localizar o loop de renderização dos critérios. Adicionar antes do input de resposta, quando `answer.evidence_status === 'aguardando_reanalise'`:

```tsx
{answer?.evidence_status === 'aguardando_reanalise' && answer?.auditor_observation && (
  <div className="mb-3 p-3 bg-amber-50 border-l-4 border-amber-500 rounded flex gap-2">
    <RotateCcw className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
    <div className="text-sm">
      <p className="font-semibold text-amber-900">Reanálise solicitada pelo auditor</p>
      <p className="text-amber-800 italic mt-1">"{answer.auditor_observation}"</p>
    </div>
  </div>
)}
{question.document_type && answer?.evidence_status === 'aprovado' && (answer?.auditor_observation || '').includes('Aprovado via cadastro') && (
  <div className="mb-3 p-2 bg-amber-100 text-amber-800 text-xs font-bold rounded inline-block">
    Atendido via cadastro ({question.document_type})
  </div>
)}
```

Adicionar `RotateCcw` no import de `lucide-react`.

- [ ] **Step 2: Modificar `PrestadorView.tsx`**

Localizar onde renderiza a instância. Adicionar botão "Enviar para Análise" no topo/rodapé, habilitado quando `instance.status IN ('em_andamento','aguardando_evidencia')`:

```tsx
const [submitting, setSubmitting] = useState(false);

const submit = async () => {
  if (!confirm('Enviar para análise? Você não poderá editar até o auditor liberar.')) return;
  setSubmitting(true);
  try {
    await fetchApi(`/eval/instances/${instance.id}/submit`, { method: 'POST' });
    alert('Enviado com sucesso!');
    // recarrega
  } catch (e: any) {
    if (e.message.includes('critérios sem resposta')) alert('Preencha todos os critérios antes de enviar.');
    else if (e.message.includes('aguardando reanálise')) alert('Ainda há critérios aguardando reanálise.');
    else alert(e.message);
  } finally { setSubmitting(false); }
};

// ... no header/footer:
{['em_andamento', 'aguardando_evidencia'].includes(instance.status) && (
  <button onClick={submit} disabled={submitting} className="btn btn-primary">
    {submitting ? 'Enviando...' : 'Enviar para Análise'}
  </button>
)}
```

- [ ] **Step 3: TS check**

```bash
npx tsc --noEmit 2>&1 | tail -3
```

Expected: 0 erros.

- [ ] **Step 4: Commit**

```bash
git add src/pages/qualificacao/RoteiroPlayer.tsx src/pages/qualificacao/PrestadorView.tsx
git commit -m "$(cat <<'EOF'
feat(qualif fatia1): reanálise + botão Enviar para Análise no PrestadorView

RoteiroPlayer mostra faixa amber com orientação do auditor
quando answer.evidence_status='aguardando_reanalise' + badge
"Atendido via cadastro" para bypass DL. PrestadorView ganha
botão "Enviar para Análise" (POST /submit) para envio inicial
e reenvio após reanálise, com mensagens de erro amigáveis.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Verificação end-to-end + homolog

**Files:** nenhum (validação + migration + reimport em homolog).

- [ ] **Step 1: Suíte completa + tsc em dev**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm test 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -3
```

Expected: todos passando, 0 erros TS.

- [ ] **Step 2: Fluxo manual em dev**

Controlador roda o dev server e o fluxo browser:
1. Logar como admin, ir em Qualificação → Ciclos → "Abrir" no Ciclo 2026 → confirmar preview → verificar N instâncias criadas.
2. Logar como prestador de teste (vinculado a alguma unidade no guia médico) → abrir o roteiro → responder alguns critérios → "Enviar para Análise".
3. Logar como auditor → Painel do Ciclo → "Analisar" na instância enviada → aprovar/reprovar/reanalisar critérios → "Emitir Parecer Final" → verificar selo calculado.
4. Voltar como prestador → aparece faixa amber nos critérios devolvidos → responder de novo → reenviar.
5. Voltar como auditor → aprovar → parecer final → selo.

- [ ] **Step 3: Aplicar migration em homolog**

```bash
node -e "const {URL}=require('url');require('dotenv').config();console.log(new URL(process.env.DATABASE_URL_HOMOLOG).hostname)"
```

Expected: `interchange.proxy.rlwy.net`. Senão PARAR.

```bash
APP_ENV=homolog npm run db:migrate 2>&1 | tail -10
```

Expected: `0020` aplicada.

- [ ] **Step 4: Reimport dos roteiros em homolog**

```bash
APP_ENV=homolog npm run db:import-roteiros -- --commit 2>&1 | tail -20
```

Expected: `document_type` populado nos roteiros de homolog.

- [ ] **Step 5: Deploy do backend/front em homolog + smoke manual**

Deploy conforme processo do projeto. Repetir o fluxo do Step 2 em homolog.

- [ ] **Step 6: Atualizar memória**

Atualizar `portal-ambientes-bancos` (migrations até 0020) e `portal-qualificacao-modulo-543` (Fatia 1 entregue: abertura, análise por critério, DL bypass, computeSeal; pendente Fatia 2: parecer/certificado/plano/relatório e Fatia 3: acompanhamento/notificações).

- [ ] **Step 7: Push**

```bash
git push origin dev
```

---

## Notas de execução

- Task 6 depende de `loadInstanceForWrite` retornar `script_id`; se não, ajustar o helper em uma linha.
- Task 11 assume que `GET /eval/instances/:id` pode não retornar `iterations` por answer nesta fatia — o modal renderiza sem histórico e o botão "Histórico" só aparece se `iters.length > 0`. Estender o endpoint fica para uma fatia futura sem quebrar UI.
- Reimport de roteiros na Task 2 depende do import ser idempotente (upsert). Se descobrir que duplica, o subagente deve reportar BLOCKED e o controlador limpa manualmente antes.
