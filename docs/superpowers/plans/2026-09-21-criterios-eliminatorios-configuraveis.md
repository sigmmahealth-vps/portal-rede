# Critérios Eliminatórios Configuráveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que `admin` e `auditoria` marquem/desmarquem, por roteiro, quais critérios são eliminatórios — e fazer plano de ação e teto Bronze seguirem essa marcação em vez da dimensão "Documento Legal".

**Architecture:** A coluna `eval_questions.is_eliminatory` já é a fonte única do cálculo do selo (`src/lib/scoreMemory.ts:101`); falta só um caminho de escrita. Criamos uma lib pura (`src/lib/eliminatory.ts`) com a herança entre versões, o diff de marcações e os fragmentos SQL compartilhados; o parser deixa de decidir eliminatório; o import herda da versão vigente; um `PATCH` grava as marcações (com trava de ciclo aberto e `auditLog`); um modal único no Admin edita qualquer versão e abre sozinho após o import.

**Tech Stack:** Node 24 + TypeScript (tsx), Express (`server.ts`), Postgres (`pg`), React + Tailwind + lucide-react, testes com `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-criterios-eliminatorios-configuraveis-design.md` · Glossário: `CONTEXT.md` ("Critério eliminatório").

## Global Constraints

- **Nenhuma migration.** Nenhuma dependência nova.
- Roles autorizados: exatamente `admin` e `auditoria` (mesmo guard inline dos endpoints `/api/eval/scripts/*`).
- Roteiro inédito nasce **sem nenhum** eliminatório; revisão herda da versão vigente por `code` + texto normalizado. Dados já existentes no banco **não** são alterados por este trabalho.
- Trava: marcações não mudam enquanto o roteiro tiver avaliação em ciclo aberto (`eval_cycles.active = true`).
- Toda alteração de marcação, import e exclusão de roteiro grava `auditLog()` (`auth/auditLog.ts`).
- Simplificações deliberadas levam comentário `// ponytail:` com o teto e o caminho de upgrade.
- Textos de UI em pt-BR. Cor primária dos botões: `#00995D` / hover `#007A4A`.
- Node **não está no PATH**: todo comando node/npm começa com `export PATH="/c/Program Files/nodejs:$PATH";` (Bash). Diretório de trabalho de todos os comandos: `portal-rede-v1-main/`.
- Testes: `node --import tsx --test <arquivo>`. Typecheck: `npm run lint` (= `tsc --noEmit`).
- Banco: só o de **dev** (seleção por `APP_ENV`/.env). Nunca apontar para homolog/prod.
- Git: branch `dev`. Mensagens de commit terminam com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/eliminatory.ts` (novo) | Lógica pura: chave de casamento, herança entre versões, diff de marcações, fragmentos SQL do "item de plano eliminatório". |
| `src/lib/eliminatory.test.ts` (novo) | Testes da lib. |
| `db/roteiro-parser.ts` / `.test.ts` | Parser deixa de emitir `isEliminatory`. |
| `db/import-roteiros.ts` | CLI herda marcações antes do DELETE. |
| `server.ts` | Import/preview com herança; `PATCH /api/eval/scripts/:id/eliminatory`; alerta/lock no GET; plano de ação e teto Bronze pela flag; `auditLog`. |
| `src/lib/actionPlan.ts` / `.test.ts` | `is_mandatory` segue `is_eliminatory`. |
| `db/prev-plan-pending.test.ts` | Teste de banco do teto Bronze pela flag atual. |
| `src/pages/qualificacao/EliminatoriosModal.tsx` (novo) | Tela de marcação por roteiro. |
| `src/pages/Admin.tsx`, `ImportRoteiroModal.tsx`, `RoteiroAlerts.tsx`, `PainelDoCiclo.tsx`, `RoteiroPlayer.tsx` | Ligações de UI. |

---

### Task 1: Lib pura `eliminatory.ts`

**Files:**
- Create: `src/lib/eliminatory.ts`
- Test: `src/lib/eliminatory.test.ts`

**Interfaces:**
- Produces:
  - `type CriterionRef = { code: string | null; text: string }`
  - `type PrevCriterion = CriterionRef & { is_eliminatory: boolean }`
  - `type CurrentCriterion = { id: number; code: string | null; is_eliminatory: boolean }`
  - `criterionKey(c: CriterionRef): string`
  - `inheritEliminatory(prev: PrevCriterion[], next: CriterionRef[]): { flags: boolean[]; lost: CriterionRef[] }` — `flags[i]` corresponde a `next[i]`; `lost` = marcações da versão anterior que não foram transportadas.
  - `diffEliminatory(current: CurrentCriterion[], markedIds: number[]): { unknownIds: number[]; toMark: CurrentCriterion[]; toUnmark: CurrentCriterion[] }`
  - `PLAN_ITEM_QUESTION_JOIN_SQL: string`, `PLAN_ITEM_ELIMINATORY_SQL: string` (assumem o alias `it` para `eval_action_items`).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/eliminatory.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criterionKey, inheritEliminatory, diffEliminatory } from './eliminatory.js';

test('criterionKey: ignora acento, caixa, pontuação e espaços; code entra na chave', () => {
  assert.equal(
    criterionKey({ code: '1.1.3', text: '  Dispõe de Alvará   Sanitário válido? ' }),
    criterionKey({ code: '1.1.3', text: 'dispoe de alvara sanitario valido' }),
  );
  assert.notEqual(
    criterionKey({ code: '1.1.3', text: 'Alvará sanitário' }),
    criterionKey({ code: '1.1.4', text: 'Alvará sanitário' }),
  );
  assert.equal(criterionKey({ code: null, text: 'X' }), '|x');
});

test('inheritEliminatory: herda marcado e desmarcado da versão anterior', () => {
  const prev = [
    { code: '1.1.1', text: 'Alvará de funcionamento', is_eliminatory: true },
    { code: '1.1.5', text: 'CNES', is_eliminatory: false },
  ];
  const next = [
    { code: '1.1.1', text: 'Alvará de funcionamento' },
    { code: '1.1.5', text: 'CNES' },
    { code: '1.1.9', text: 'Critério novo' },
  ];
  const { flags, lost } = inheritEliminatory(prev, next);
  assert.deepEqual(flags, [true, false, false]); // novo nasce desmarcado
  assert.deepEqual(lost, []);
});

test('inheritEliminatory: texto alterado ou critério removido não herda e vai para lost', () => {
  const prev = [
    { code: '1.1.1', text: 'Alvará de funcionamento', is_eliminatory: true },
    { code: '1.1.2', text: 'Alvará dos bombeiros', is_eliminatory: true },
  ];
  const next = [{ code: '1.1.1', text: 'Alvará de funcionamento e localização' }];
  const { flags, lost } = inheritEliminatory(prev, next);
  assert.deepEqual(flags, [false]);
  assert.deepEqual(lost.map(l => l.code), ['1.1.1', '1.1.2']);
});

test('inheritEliminatory: chave repetida com marcações divergentes é ambígua → não herda', () => {
  const prev = [
    { code: '1.2.7', text: 'Mesmo texto', is_eliminatory: true },
    { code: '1.2.7', text: 'Mesmo texto', is_eliminatory: false },
  ];
  const { flags, lost } = inheritEliminatory(prev, [{ code: '1.2.7', text: 'Mesmo texto' }]);
  assert.deepEqual(flags, [false]);
  assert.equal(lost.length, 1);
});

test('inheritEliminatory: sem versão anterior → tudo desmarcado', () => {
  const { flags, lost } = inheritEliminatory([], [{ code: '1.1.1', text: 'A' }, { code: null, text: 'B' }]);
  assert.deepEqual(flags, [false, false]);
  assert.deepEqual(lost, []);
});

test('diffEliminatory: separa o que marcar, o que desmarcar e ids de fora do roteiro', () => {
  const current = [
    { id: 1, code: 'a', is_eliminatory: true },
    { id: 2, code: 'b', is_eliminatory: false },
    { id: 3, code: 'c', is_eliminatory: true },
  ];
  const d = diffEliminatory(current, [2, 3, 99]);
  assert.deepEqual(d.unknownIds, [99]);
  assert.deepEqual(d.toMark.map(c => c.id), [2]);
  assert.deepEqual(d.toUnmark.map(c => c.id), [1]);
});

test('diffEliminatory: lista vazia desmarca tudo (roteiro sem eliminatório é permitido)', () => {
  const d = diffEliminatory([{ id: 1, code: 'a', is_eliminatory: true }], []);
  assert.deepEqual(d.toUnmark.map(c => c.id), [1]);
  assert.deepEqual(d.toMark, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test src/lib/eliminatory.test.ts`
Expected: FAIL — `Cannot find module './eliminatory.js'`.

- [ ] **Step 3: Implementar**

```ts
// src/lib/eliminatory.ts
// Critérios eliminatórios configuráveis por roteiro (spec 2026-09-21). Lógica pura, sem I/O.

export type CriterionRef = { code: string | null; text: string };
export type PrevCriterion = CriterionRef & { is_eliminatory: boolean };
export type CurrentCriterion = { id: number; code: string | null; is_eliminatory: boolean };

/**
 * Chave de casamento de um critério entre versões do roteiro: code + texto
 * normalizado. `code` sozinho não serve — repete dentro do mesmo roteiro
 * (6 de 15 planilhas) e pode ser NULL.
 */
export function criterionKey(c: CriterionRef): string {
  const text = c.text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${c.code ?? ''}|${text}`;
}

/**
 * Marcações que a nova versão herda da anterior. Só herda `true` quando TODAS as
 * ocorrências da chave na versão anterior estavam marcadas (chave repetida com
 * marcações divergentes é ambígua). `lost` = marcações que não foram
 * transportadas (critério removido, texto alterado ou ambíguo) — para revisão.
 */
export function inheritEliminatory(
  prev: PrevCriterion[], next: CriterionRef[],
): { flags: boolean[]; lost: CriterionRef[] } {
  const byKey = new Map<string, boolean[]>();
  for (const p of prev) {
    const k = criterionKey(p);
    byKey.set(k, [...(byKey.get(k) ?? []), p.is_eliminatory]);
  }
  const flags = next.map(n => byKey.get(criterionKey(n))?.every(Boolean) ?? false);
  const carried = new Set(next.filter((_, i) => flags[i]).map(criterionKey));
  const lost = prev
    .filter(p => p.is_eliminatory && !carried.has(criterionKey(p)))
    .map(({ code, text }) => ({ code, text }));
  return { flags, lost };
}

/** Diferença entre as marcações atuais e o conjunto desejado (ids marcados). */
export function diffEliminatory(current: CurrentCriterion[], markedIds: number[]) {
  const ids = new Set(current.map(c => c.id));
  const marked = new Set(markedIds);
  return {
    unknownIds: markedIds.filter(id => !ids.has(id)),
    toMark: current.filter(c => !c.is_eliminatory && marked.has(c.id)),
    toUnmark: current.filter(c => c.is_eliminatory && !marked.has(c.id)),
  };
}

// Item de plano de ação "eliminatório" = marcação ATUAL do critério de origem
// (decisão Q9-B da spec). Sem answer_id (ON DELETE SET NULL) cai na regra antiga.
// Assumem o alias `it` para eval_action_items.
// ponytail: lê a flag da versão do roteiro usada naquele ciclo; desmarcar numa
// revisão nova não alcança planos antigos (contorno: editar a versão anterior).
// Upgrade: congelar is_eliminatory em eval_action_items na geração do plano.
export const PLAN_ITEM_QUESTION_JOIN_SQL = `
  LEFT JOIN eval_answers ea_it ON ea_it.id = it.answer_id
  LEFT JOIN eval_questions eq_it ON eq_it.id = ea_it.question_id`;
export const PLAN_ITEM_ELIMINATORY_SQL =
  `COALESCE(eq_it.is_eliminatory, it.dimension = 'Documento Legal')`;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test src/lib/eliminatory.test.ts`
Expected: PASS — 7 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eliminatory.ts src/lib/eliminatory.test.ts
git commit -m "feat(qualificacao): lib pura de critérios eliminatórios (herança e diff)"
```

---

### Task 2: Parser deixa de decidir eliminatório; CLI herda

**Files:**
- Modify: `db/roteiro-parser.ts:104` e `:249-251`
- Modify: `db/roteiro-parser.test.ts:76-121`
- Modify: `db/import-roteiros.ts:39-81`

**Interfaces:**
- Consumes: `inheritEliminatory` (Task 1).
- Produces: `QuestionNode` **sem** o campo `isEliminatory`. Quem insere `eval_questions` passa a flag vinda de `inheritEliminatory`.

- [ ] **Step 1: Trocar os testes do parser**

Em `db/roteiro-parser.test.ts`, substituir os dois testes `parseWorkbook: isEliminatory detecta "eliminatório" e normal = false` e `parseWorkbook: critério DL (Documento Legal) é eliminatório` (linhas 106-121) por:

```ts
// Spec 2026-09-21: eliminatório é marcação feita por admin/auditoria na tela —
// o parser não decide mais (nem por DL, nem por "eliminatório" no texto).
test('parseWorkbook: parser não emite isEliminatory (nem para DL, nem pelo texto)', () => {
  const parsed = parseWorkbook(buildBuffer2(), 'OPS-RED-FOR-099 - Extra.xlsx');
  const dl = parsed.questions.find((q) => q.code === '2.1.4');
  const elimNoTexto = parsed.questions.find((q) => q.code === '2.1.2');
  assert.ok(dl && elimNoTexto, 'ambas as questões devem existir');
  assert.equal(dl.dimension, 'Documento Legal');
  assert.equal('isEliminatory' in dl, false);
  assert.equal('isEliminatory' in elimNoTexto, false);
});
```

E ajustar o comentário de `buildBuffer2` (linha 76) para `/** Planilha extra para testar weight-fallback e dimensão DL. */`, e os comentários internos das linhas 85, 87 e 89 para `// texto com "eliminatório": não deve marcar nada`, `// critério comum` e `// DL: só define a dimensão`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/roteiro-parser.test.ts`
Expected: FAIL no teste novo (`'isEliminatory' in dl` é `true`).

- [ ] **Step 3: Remover do parser**

Em `db/roteiro-parser.ts`: apagar a linha 104 (`isEliminatory: boolean;` em `QuestionNode`) e, no `questions.push({...})`, apagar as três linhas 249-251:

```ts
      // Critérios DL (Documento Legal) são eliminatórios: reprovação rebaixa a Bronze
      // independentemente da pontuação (ver computeSeal).
      isEliminatory: dimension === 'Documento Legal' || /mandat[óo]ri|eliminat[óo]ri/i.test(a),
```

Com isso o 4º parâmetro `a` de `addQuestion` fica sem uso (era lido só na linha removida). Trocar a assinatura (L226) por `const addQuestion = (code: string | null, text: string, row: string[]): void => {` e as duas chamadas: L270 vira `addQuestion(mQuestion[1], mQuestion[2].trim(), row);` e L287 vira `addQuestion(null, a, row);`.

- [ ] **Step 4: CLI herda as marcações antes de apagar**

Em `db/import-roteiros.ts`, adicionar o import no topo junto dos demais:

```ts
import { inheritEliminatory } from '../src/lib/eliminatory.js';
```

Em `commitScript`, substituir a linha do DELETE (L42-43) por:

```ts
    // Marcações de eliminatório são manuais (tela do Admin): captura ANTES do DELETE
    // para a recarga não as perder.
    // ponytail: se houver mais de uma versão do arquivo, mistura todas; marcações
    // divergentes viram "não herda". Upgrade: ler só a versão vigente.
    const { rows: prev } = await client.query(
      `SELECT eq.code, eq.text, eq.is_eliminatory
         FROM eval_questions eq
         JOIN eval_sections es ON es.id = eq.section_id
         JOIN eval_scripts s ON s.id = es.script_id
        WHERE s.source_file = $1`, [parsed.sourceFile]);
    const { flags, lost } = inheritEliminatory(prev as any, parsed.questions);
    if (lost.length) console.warn(`  ! ${parsed.sourceFile}: ${lost.length} marcação(ões) de eliminatório não transportada(s): ${lost.map(l => l.code ?? '(sem código)').join(', ')}`);
    // idempotência: recarrega substituindo a versão anterior do mesmo arquivo
    await client.query('DELETE FROM eval_scripts WHERE source_file = $1', [parsed.sourceFile]);
```

E no laço de critérios (L66-79) trocar o cabeçalho do `for` e o valor inserido:

```ts
    for (const [i, q] of parsed.questions.entries()) {
      const sectionId = q.sectionTmp != null ? idByTmp.get(q.sectionTmp) ?? null : null;
      if (sectionId == null) continue; // critério sem seção: ignora (não deveria ocorrer)
      await client.query(
        `INSERT INTO eval_questions
           (section_id, code, text, legislation, type, weight, max_score, dimension, document_type,
            guidance, evidence_required, is_eliminatory, order_index)
         VALUES ($1,$2,$3,$4,'sim_nao',$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          sectionId, q.code, q.text, q.legislation, q.weight, q.maxScore,
          q.dimension, q.documentType, q.guidance, q.evidenceRequired, flags[i], q.order,
        ],
      );
    }
```

- [ ] **Step 5: Rodar testes do parser**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/roteiro-parser.test.ts`
Expected: PASS em todos.

(`npm run lint` ainda falha em `server.ts` por causa de `q.isEliminatory` — é corrigido na Task 3. Commitar as duas juntas: **não commitar ainda**.)

---

### Task 3: Import web herda; preview mostra; import/exclusão auditados

**Files:**
- Modify: `server.ts` — imports (~L18), preview (L3256-3320), import (L3322-3410), delete (L3412-3450)

**Interfaces:**
- Consumes: `inheritEliminatory`, `PrevCriterion` (Task 1); `scriptVersionNum` (`server.ts:98`); `auditLog`, `hashClientIp` (já no escopo).
- Produces:
  - resposta do preview ganha `eliminatory: { hasPrevious: boolean; inherited: number; lost: { code: string | null; text: string }[] }`
  - resposta do import segue devolvendo `id` (usado pelo front na Task 8).
  - helper `vigenteEliminatory(sourceFile: string): Promise<PrevCriterion[]>` no escopo dos endpoints.

- [ ] **Step 1: Import da lib**

No topo de `server.ts`, logo abaixo de `import { auditLog } from './auth/auditLog.js';`:

```ts
import { inheritEliminatory, diffEliminatory, PLAN_ITEM_QUESTION_JOIN_SQL, PLAN_ITEM_ELIMINATORY_SQL, type PrevCriterion } from './src/lib/eliminatory.js';
```

- [ ] **Step 2: Helper da versão vigente**

Imediatamente antes de `app.post('/api/eval/scripts/preview', ...)`:

```ts
  // Marcações de eliminatório da versão vigente (maior revisão) do mesmo arquivo —
  // base da herança no import (spec 2026-09-21). Roteiro inédito → [].
  async function vigenteEliminatory(sourceFile: string): Promise<PrevCriterion[]> {
    const { rows: versions } = await query('SELECT id, version FROM eval_scripts WHERE source_file = $1', [sourceFile]);
    if (!versions.length) return [];
    const vigente = (versions as any[]).reduce((a, b) => (scriptVersionNum(b.version) > scriptVersionNum(a.version) ? b : a));
    const { rows } = await query(
      `SELECT eq.code, eq.text, eq.is_eliminatory
         FROM eval_questions eq JOIN eval_sections es ON es.id = eq.section_id
        WHERE es.script_id = $1`, [vigente.id]);
    return rows as any;
  }
```

- [ ] **Step 3: Preview**

No endpoint de preview, antes do `res.json({`:

```ts
      const prevElim = await vigenteEliminatory(parsed.sourceFile);
      const inherit = inheritEliminatory(prevElim, parsed.questions);
```

e dentro do objeto do `res.json`, depois de `warnings: {...},`:

```ts
        eliminatory: {
          hasPrevious: prevElim.length > 0,
          inherited: inherit.flags.filter(Boolean).length,
          lost: inherit.lost,
        },
```

- [ ] **Step 4: Import**

No endpoint de import, logo antes do `try { const result = await withTransaction(...`:

```ts
      const { flags: elimFlags } = inheritEliminatory(await vigenteEliminatory(parsed.sourceFile), parsed.questions);
```

Trocar `for (const q of parsed.questions) {` por `for (const [i, q] of parsed.questions.entries()) {` e, no array de parâmetros do INSERT, `q.isEliminatory` por `elimFlags[i]`.

Logo antes do `res.json({ success: true, ...` do import:

```ts
        await auditLog({
          query, userId: req.user.id, action: 'eval_script_imported',
          meta: { script_id: result.id, source_file: parsed.sourceFile, version, eliminatory_inherited: elimFlags.filter(Boolean).length },
          ip: hashClientIp(req),
        });
```

- [ ] **Step 5: Exclusão auditada**

No endpoint DELETE, logo depois de `const scriptId = req.params.id;`:

```ts
        const { rows: [toDelete] } = await query('SELECT source_file, version FROM eval_scripts WHERE id = $1', [scriptId]);
```

e logo antes de `res.json({ success: true });`:

```ts
        await auditLog({
          query, userId: req.user.id, action: 'eval_script_deleted',
          meta: { script_id: Number(scriptId), source_file: toDelete?.source_file ?? null, version: toDelete?.version ?? null, usage_count: usageCount },
          ip: hashClientIp(req),
        });
```

- [ ] **Step 6: Typecheck**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run lint`
Expected: sem erros. (O `tsconfig.json` não liga `noUnusedLocals`, então `diffEliminatory` e os fragmentos SQL importados aqui e usados só nas Tasks 4 e 6 não acusam nada.)

- [ ] **Step 7: Commit (Tasks 2 + 3)**

```bash
git add db/roteiro-parser.ts db/roteiro-parser.test.ts db/import-roteiros.ts server.ts
git commit -m "feat(qualificacao): parser não marca eliminatório; import herda da versão vigente e é auditado"
```

---

### Task 4: API de marcação — alerta, trava e PATCH

**Files:**
- Modify: `server.ts` — GET `/api/eval/scripts` (L3452-3501), GET `/api/eval/scripts/:id` (L3503-3520), novo PATCH logo após o DELETE.

**Interfaces:**
- Consumes: `diffEliminatory` (Task 1).
- Produces:
  - `GET /api/eval/scripts` → cada script ganha `alerts.semEliminatorio: boolean` e `eliminatory_locked: boolean`.
  - `GET /api/eval/scripts/:id` → ganha `eliminatory_locked: boolean` (as `questions` já trazem `id, section_id, code, text, dimension, is_eliminatory, order_index`).
  - `PATCH /api/eval/scripts/:id/eliminatory` body `{ question_ids: number[] }` (conjunto **completo** dos marcados) → `200 { success: true, marked: number, unmarked: number }`; `400` ids inválidos/de outro roteiro; `403` role; `404` roteiro; `409 { error }` trava.

- [ ] **Step 1: Helper da trava**

Junto de `vigenteEliminatory`:

```ts
  // Trava (spec Q4): marcações não mudam com avaliação do roteiro em ciclo aberto.
  async function eliminatoryLocked(scriptId: number | string): Promise<boolean> {
    const { rows: [r] } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM eval_instances i JOIN eval_cycles c ON c.id = i.cycle_id
          WHERE i.script_id = $1 AND c.active) AS locked`, [scriptId]);
    return !!r?.locked;
  }
```

- [ ] **Step 2: GET lista**

No SELECT de critérios da lista (L3477-3483) acrescentar a coluna: `SELECT eq.id, eq.text as title, eq.code, eq.evidence_required, eq.max_score, eq.is_eliminatory`.

Depois do cálculo de `semPeso`:

```ts
        const semEliminatorio = !(questions as any[]).some((q) => q.is_eliminatory);
```

E trocar o `push` por:

```ts
        scriptsWithItems.push({
          ...script, items: questions, is_current: isCurrent,
          alerts: { semEvidencia, semPeso, semEliminatorio },
          usage_count: usageCount, eliminatory_locked: await eliminatoryLocked(script.id),
        });
```

- [ ] **Step 3: GET detalhe**

Trocar `res.json({ ...script, sections, questions });` por:

```ts
      res.json({ ...script, sections, questions, eliminatory_locked: await eliminatoryLocked(script.id) });
```

- [ ] **Step 4: PATCH**

Logo após o fechamento do `app.delete('/api/eval/scripts/:id', ...)`:

```ts
  // Marcação dos critérios eliminatórios do roteiro (spec 2026-09-21). Body traz o
  // conjunto COMPLETO de ids marcados — idempotente; lista vazia é permitida.
  app.patch('/api/eval/scripts/:id/eliminatory', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const scriptId = Number(req.params.id);
      const raw = req.body?.question_ids;
      if (!Number.isInteger(scriptId) || !Array.isArray(raw) || raw.some((v: any) => !Number.isInteger(Number(v)))) {
        return res.status(400).json({ error: 'Envie question_ids como lista de ids de critérios.' });
      }
      const { rows: [script] } = await query('SELECT id, source_file, version FROM eval_scripts WHERE id = $1', [scriptId]);
      if (!script) return res.status(404).json({ error: 'Roteiro não encontrado.' });
      // ponytail: checagem fora da transação — corrida com "abrir ciclo" no mesmo
      // instante é aceitável. Upgrade: SELECT ... FOR UPDATE no ciclo.
      if (await eliminatoryLocked(scriptId)) {
        return res.status(409).json({ error: 'Este roteiro tem avaliações em ciclo aberto. Os critérios eliminatórios só podem ser alterados com o ciclo encerrado.' });
      }
      const { rows: current } = await query(
        `SELECT eq.id, eq.code, eq.is_eliminatory
           FROM eval_questions eq JOIN eval_sections es ON es.id = eq.section_id
          WHERE es.script_id = $1`, [scriptId]);
      const diff = diffEliminatory(
        (current as any[]).map((c) => ({ id: Number(c.id), code: c.code, is_eliminatory: !!c.is_eliminatory })),
        raw.map(Number),
      );
      if (diff.unknownIds.length) {
        return res.status(400).json({ error: 'Há critérios que não pertencem a este roteiro.' });
      }
      if (diff.toMark.length || diff.toUnmark.length) {
        await withTransaction(async (client) => {
          await client.query('UPDATE eval_questions SET is_eliminatory = true  WHERE id = ANY($1::bigint[])', [diff.toMark.map((c) => c.id)]);
          await client.query('UPDATE eval_questions SET is_eliminatory = false WHERE id = ANY($1::bigint[])', [diff.toUnmark.map((c) => c.id)]);
        });
        await auditLog({
          query, userId: req.user.id, action: 'eval_eliminatory_changed',
          meta: {
            script_id: scriptId, source_file: script.source_file, version: script.version,
            marked: diff.toMark.map((c) => c.code ?? `#${c.id}`),
            unmarked: diff.toUnmark.map((c) => c.code ?? `#${c.id}`),
          },
          ip: hashClientIp(req),
        });
      }
      res.json({ success: true, marked: diff.toMark.length, unmarked: diff.toUnmark.length });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 5: Typecheck**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat(qualificacao): PATCH de critérios eliminatórios por roteiro com trava de ciclo aberto e auditoria"
```

---

### Task 5: Plano de ação — obrigatório segue a marcação

**Files:**
- Modify: `src/lib/actionPlan.ts:70-116`
- Modify: `src/lib/actionPlan.test.ts:105-175`
- Modify: `server.ts:5520-5530` e `server.ts:5658-5667`

**Interfaces:**
- Produces: `AnswerForPlan` ganha `is_eliminatory: boolean`. `buildAutoItems` mantém a assinatura.

- [ ] **Step 1: Testes novos + fixtures**

Em `src/lib/actionPlan.test.ts`:

1. Em **todas** as fixtures de `buildAutoItems` acrescentar a propriedade `is_eliminatory`: `true` nas duas de Documento Legal (`id: 1` do teste "não pontuados viram itens; DL é obrigatório" e `id: 1921` do teste "DL não enviada aprovada pelo auditor") e `false` em todas as outras (`id: 2`, `3`, `5`, `6`, `2` do teste de Segurança <60%, `'7'`).
2. Renomear o primeiro teste para `'buildAutoItems: não pontuados viram itens; eliminatório é obrigatório'`.
3. Acrescentar ao final do arquivo:

```ts
// Spec 2026-09-21: obrigatoriedade segue a MARCAÇÃO de eliminatório, não a dimensão.
test('buildAutoItems: critério de Segurança marcado eliminatório é obrigatório mesmo com Segurança >= 60%', () => {
  const items = buildAutoItems([
    { id: 10, question_code: '1.1.1', question_text: 'Alvará de funcionamento (hospital)',
      legislation: null, dimension: 'Segurança', is_eliminatory: true,
      answer_value: 'nao', score_obtained: 0, max_score: 10, guidance: null },
  ], { segurancaPct: 95 });
  assert.equal(items[0].is_mandatory, true);
});

test('buildAutoItems: Documento Legal desmarcado não é obrigatório por si só', () => {
  const items = buildAutoItems([
    { id: 11, question_code: '1.1.5', question_text: 'CNES',
      legislation: null, dimension: 'Documento Legal', is_eliminatory: false,
      answer_value: 'nao', score_obtained: 0, max_score: 10, guidance: null },
  ], { segurancaPct: 95 });
  assert.equal(items.length, 1);
  assert.equal(items[0].is_mandatory, false);
});

test('buildAutoItems: DL desmarcado vira obrigatório com Segurança < 60% (DL consolida em Segurança)', () => {
  const items = buildAutoItems([
    { id: 12, question_code: '1.1.5', question_text: 'CNES',
      legislation: null, dimension: 'Documento Legal', is_eliminatory: false,
      answer_value: 'nao', score_obtained: 0, max_score: 10, guidance: null },
  ], { segurancaPct: 45 });
  assert.equal(items[0].is_mandatory, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test src/lib/actionPlan.test.ts`
Expected: FAIL em 2 dos 3 testes novos — "Segurança marcada" (hoje dá `false`) e "DL desmarcado" (hoje dá `true`). O terceiro (DL desmarcado com Segurança < 60%) já passa com o código antigo, porque DL é sempre obrigatório; ele existe para travar o comportamento depois da mudança.

- [ ] **Step 3: Implementar**

Em `src/lib/actionPlan.ts`, no tipo `AnswerForPlan` trocar a linha `legislation: string | null; dimension: string | null;` por:

```ts
  legislation: string | null; dimension: string | null; is_eliminatory: boolean;
```

e substituir o corpo do `.map` de `buildAutoItems` (L100-108) por:

```ts
  return nonCompliant.map(a => {
    // Obrigatório = critério eliminatório (marcação do roteiro, spec 2026-09-21) ou
    // Segurança < 60%. Documento Legal consolida em Segurança (mesma base do segurancaPct).
    const isSeg = a.dimension === 'Segurança' || a.dimension === 'Documento Legal';
    return {
      answer_id: Number(a.id), // pg retorna bigint como string; Number() evita Set.has() falso-negativo
      question_code: a.question_code,
      question_text: a.question_text,
      dimension: a.dimension,
      is_mandatory: !!a.is_eliminatory || (isSeg && segMandatory),
```

(o restante do objeto — `what`, `why`, `how` — fica como está; as variáveis `isDL` e o `isSeg` antigo somem).

- [ ] **Step 4: Alimentar a flag nos dois SELECTs do servidor**

Em `server.ts`, nas duas queries de candidatos (L5520-5530 — prévia — e L5658-5667 — parecer), trocar a linha `eq.legislation, eq.dimension, eq.guidance,` por:

```sql
               eq.legislation, eq.dimension, eq.guidance, eq.is_eliminatory,
```

- [ ] **Step 5: Rodar e ver passar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test src/lib/actionPlan.test.ts && npm run lint`
Expected: PASS em todos; lint sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actionPlan.ts src/lib/actionPlan.test.ts server.ts
git commit -m "feat(plano-acao): item obrigatório segue a marcação de eliminatório, não a dimensão DL"
```

---

### Task 6: Teto Bronze por plano pendente segue a marcação atual

**Files:**
- Modify: `server.ts:5549-5564` (`pendingPrevPlan`), `:5652`, `:5845`, `:6678-6694` (painel do ciclo)
- Modify: `db/prev-plan-pending.test.ts`
- Modify: `src/pages/qualificacao/PainelDoCiclo.tsx:295-299`, `src/lib/auditorDashboard.ts:24`

**Interfaces:**
- Consumes: `PLAN_ITEM_QUESTION_JOIN_SQL`, `PLAN_ITEM_ELIMINATORY_SQL` (Task 1).
- Produces: `pendingPrevPlan(...)` → `{ pending: boolean; hasEliminatory: boolean }` (renomeado de `hasDL`). Os nomes de API `prev_plan_dl` e `seal_cap: 'plano_dl_ciclo_anterior'` **não mudam** (contrato com o front).

- [ ] **Step 1: Reescrever o teste de banco**

Substituir `db/prev-plan-pending.test.ts` inteiro por:

```ts
// Item 18 (homologação 09/2026) + spec 2026-09-21: plano de OUTRO ciclo ainda aberto
// sinaliza o ciclo seguinte; item ELIMINATÓRIO pendente trava o selo em Bronze. A
// marcação é a ATUAL do critério (via answer_id); sem answer_id, cai em dimension = DL.
// Sem harness de servidor, exercita a MESMA query de pendingPrevPlan (server.ts).
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';
import { PLAN_ITEM_QUESTION_JOIN_SQL, PLAN_ITEM_ELIMINATORY_SQL } from '../src/lib/eliminatory.js';

async function pendingPrevPlan(providerId: number, locationId: number | null, cycleId: number | null) {
  const { rows: [r] } = await query(`
    SELECT BOOL_OR(${PLAN_ITEM_ELIMINATORY_SQL}) AS has_elim
      FROM eval_action_plans ap
      JOIN eval_action_items it ON it.plan_id = ap.id AND it.status <> 'concluida'
      ${PLAN_ITEM_QUESTION_JOIN_SQL}
     WHERE ap.provider_id = $1
       AND (ap.location_id IS NULL OR ap.location_id = $2)
       AND ap.closed_without_completion = false
       AND ap.cycle_id IS DISTINCT FROM $3
  `, [providerId, locationId, cycleId]);
  return { pending: r?.has_elim != null, hasEliminatory: !!r?.has_elim };
}

test('pendingPrevPlan: eliminatório pendente (marcação atual) trava Bronze; fallback por dimensão sem answer_id', async () => {
  const ids: { cycles: number[]; prov?: number; plan?: number; script?: number } = { cycles: [] };
  try {
    const { rows: [p] } = await query(
      `INSERT INTO providers (sgu_code, name, status) VALUES ('_TEST_PPP_', '_TEST_PPP_', 'Ativo') RETURNING id`);
    ids.prov = Number(p.id);
    for (const label of ['_TEST_PPP_C1_', '_TEST_PPP_C2_']) {
      const { rows: [c] } = await query(
        `INSERT INTO eval_cycles (label, start_date, end_date, active, cert_valid_until)
         VALUES ($1, '2026-01-01', '2026-06-30', false, '2027-06-30') RETURNING id`, [label]);
      ids.cycles.push(Number(c.id));
    }
    const [c1, c2] = ids.cycles;

    // Roteiro mínimo: um critério de SEGURANÇA marcado eliminatório, respondido no ciclo 1.
    const { rows: [s] } = await query(
      `INSERT INTO eval_scripts (title, version, source_file, revisao_date, implantacao_date)
       VALUES ('_TEST_PPP_', '00', '_TEST_PPP_.xlsx', '2026-01-01', '2026-01-01') RETURNING id`);
    ids.script = Number(s.id);
    const { rows: [sec] } = await query(
      `INSERT INTO eval_sections (script_id, name, order_index) VALUES ($1, '_TEST_PPP_', 1) RETURNING id`, [ids.script]);
    const { rows: [q] } = await query(
      `INSERT INTO eval_questions (section_id, code, text, type, max_score, dimension, is_eliminatory, order_index)
       VALUES ($1, '1.1.1', 'Alvará', 'sim_nao', 10, 'Segurança', true, 1) RETURNING id`, [sec.id]);
    const { rows: [inst] } = await query(
      `INSERT INTO eval_instances (script_id, provider_id, cycle_id, status) VALUES ($1, $2, $3, 'aprovado') RETURNING id`,
      [ids.script, ids.prov, c1]);
    const { rows: [ans] } = await query(
      `INSERT INTO eval_answers (instance_id, question_id, answer_value, score_obtained) VALUES ($1, $2, 'nao', 0) RETURNING id`,
      [inst.id, q.id]);

    const { rows: [plan] } = await query(
      `INSERT INTO eval_action_plans (cycle_id, provider_id, origin) VALUES ($1, $2, 'manual') RETURNING id`,
      [c1, ids.prov]);
    ids.plan = Number(plan.id);
    const item = async (dimension: string, status: string, answerId: number | null) => {
      const { rows: [it] } = await query(
        `INSERT INTO eval_action_items (plan_id, answer_id, dimension, what, status) VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
        [ids.plan, answerId, dimension, status]);
      return Number(it.id);
    };
    const seg = await item('Segurança', 'em_andamento', Number(ans.id)); // ligado ao critério marcado
    await item('Conforto', 'nao_iniciada', null);

    // Visto do ciclo 2: pendente e com eliminatório (Segurança marcada) → trava Bronze.
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: true });
    // Visto do PRÓPRIO ciclo 1: plano é do ciclo corrente, não sinaliza.
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c1), { pending: false, hasEliminatory: false });

    // Desmarcar o critério "perdoa" o plano antigo (marcação ATUAL, decisão Q9-B).
    await query('UPDATE eval_questions SET is_eliminatory = false WHERE id = $1', [q.id]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: false });

    // Fallback: item SEM answer_id e dimensão Documento Legal segue travando.
    const dlSolto = await item('Documento Legal', 'em_andamento', null);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: true });

    // Concluídos os dois, resta Conforto aberto: pendente sem trava de selo.
    await query(`UPDATE eval_action_items SET status = 'concluida' WHERE id = ANY($1::bigint[])`, [[seg, dlSolto]]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: false });

    // Encerrado sem conclusão: deixa de sinalizar.
    await query(`UPDATE eval_action_plans SET closed_without_completion = true WHERE id = $1`, [ids.plan]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: false, hasEliminatory: false });
  } finally {
    if (ids.plan) await query('DELETE FROM eval_action_plans WHERE id = $1', [ids.plan]);
    if (ids.script) await query('DELETE FROM eval_scripts WHERE id = $1', [ids.script]); // cascade: seções, critérios, instância, resposta
    if (ids.cycles.length) await query('DELETE FROM eval_cycles WHERE id = ANY($1::bigint[])', [ids.cycles]);
    if (ids.prov) await query('DELETE FROM providers WHERE id = $1', [ids.prov]);
    await pool.end();
  }
});
```

- [ ] **Step 2: Rodar (banco de dev)**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/prev-plan-pending.test.ts`
Expected: PASS (a query do teste já é a nova; este passo valida o SQL contra o schema real). Se algum INSERT falhar por coluna NOT NULL que este plano não previu, acrescentar a coluna exigida ao INSERT do teste com um valor neutro e seguir.

- [ ] **Step 3: Aplicar a mesma query no servidor**

Em `server.ts`, substituir o comentário + função `pendingPrevPlan` (L5549-5564) por:

```ts
  // Plano de ação de OUTRO ciclo (anterior/avulso) ainda aberto para o par
  // prestador×local: aberto = não encerrado sem conclusão e com item não concluído.
  // has_elim marca item de critério ELIMINATÓRIO (marcação atual do roteiro; sem
  // answer_id cai em Documento Legal) — item 18 da homologação 09/2026 + spec
  // 2026-09-21: com eliminatório pendente, o selo do ciclo seguinte trava em Bronze.
  async function pendingPrevPlan(providerId: number, locationId: number | null, cycleId: number | null) {
    const { rows: [r] } = await query(`
      SELECT BOOL_OR(${PLAN_ITEM_ELIMINATORY_SQL}) AS has_elim
        FROM eval_action_plans ap
        JOIN eval_action_items it ON it.plan_id = ap.id AND it.status <> 'concluida'
        ${PLAN_ITEM_QUESTION_JOIN_SQL}
       WHERE ap.provider_id = $1
         AND (ap.location_id IS NULL OR ap.location_id = $2)
         AND ap.closed_without_completion = false
         AND ap.cycle_id IS DISTINCT FROM $3
    `, [providerId, locationId, cycleId]);
    return { pending: r?.has_elim != null, hasEliminatory: !!r?.has_elim };
  }
```

Trocar os dois usos: L5652 `const seal = prevPlan.hasEliminatory ? 'Bronze' : mem.seal;` e L5845 `if (prevPlan.hasEliminatory && payload.seal !== 'Bronze') {`. Acima de `payload.seal_cap = 'plano_dl_ciclo_anterior';` acrescentar:

```ts
        // ponytail: o identificador guarda "dl" por contrato com o front; hoje significa "eliminatório".
```

No painel do ciclo (L6686-6694), substituir o LATERAL por:

```sql
          LEFT JOIN LATERAL (
            SELECT BOOL_OR(${PLAN_ITEM_ELIMINATORY_SQL}) AS has_dl
              FROM eval_action_plans ap
              JOIN eval_action_items it ON it.plan_id = ap.id AND it.status <> 'concluida'
              ${PLAN_ITEM_QUESTION_JOIN_SQL}
             WHERE ap.provider_id = ei.provider_id
               AND (ap.location_id IS NULL OR ap.location_id = ei.location_id)
               AND ap.closed_without_completion = false
               AND ap.cycle_id IS DISTINCT FROM ei.cycle_id
          ) prev_plan ON true
```

e ajustar o comentário da L6678 para `-- Item 18: plano de outro ciclo ainda aberto p/ o par (has_dl = item eliminatório pendente → trava selo em Bronze).`

- [ ] **Step 4: Textos**

Em `src/pages/qualificacao/PainelDoCiclo.tsx` (L295-299):

```tsx
                        title={i.prev_plan_dl
                          ? 'Plano de ação de ciclo anterior com critério eliminatório pendente — o selo deste ciclo fica limitado a Bronze até a conclusão.'
                          : 'Plano de ação de ciclo anterior ainda em aberto.'}
                      >
                        {i.prev_plan_dl ? 'Eliminatório pendente — selo máx. Bronze' : 'Plano pendente do ciclo anterior'}
```

Em `src/lib/auditorDashboard.ts:24`, trocar `com item de Documento Legal pendente (prev_plan_dl)` por `com item de critério eliminatório pendente (prev_plan_dl)`.

- [ ] **Step 5: Verificar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run lint && node --import tsx --test db/prev-plan-pending.test.ts`
Expected: lint sem erros; teste PASS.

- [ ] **Step 6: Commit**

```bash
git add server.ts db/prev-plan-pending.test.ts src/pages/qualificacao/PainelDoCiclo.tsx src/lib/auditorDashboard.ts
git commit -m "feat(qualificacao): teto Bronze por plano pendente segue a marcação atual de eliminatório"
```

---

### Task 7: Tela "Critérios eliminatórios" + entrada no Admin

**Files:**
- Create: `src/pages/qualificacao/EliminatoriosModal.tsx`
- Modify: `src/pages/Admin.tsx` — imports (L5-7, bloco lucide L10-30), estado, 4 pontos de botão (L673-679, L721-727, L779-781, L797-799), bloco de modais (L1257-1270)

**Interfaces:**
- Consumes: `GET /api/eval/scripts/:id` (com `eliminatory_locked`) e `PATCH /api/eval/scripts/:id/eliminatory` (Task 4).
- Produces: `<EliminatoriosModal scriptId={number} onClose={() => void} onSaved={() => void} />`; em `Admin.tsx`, o estado `eliminatoriosTarget: number | null` / `setEliminatoriosTarget` (usado pela Task 8).

- [ ] **Step 1: Criar o modal**

```tsx
// src/pages/qualificacao/EliminatoriosModal.tsx
// Marcação dos critérios eliminatórios de um roteiro (spec 2026-09-21).
import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, AlertTriangle, Loader2, Lock, Save } from 'lucide-react';

interface Question {
  id: number | string; section_id: number | string; code: string | null; text: string;
  dimension: string | null; is_eliminatory: boolean; order_index: number;
}
interface Section { id: number | string; name: string }
interface ScriptDetail {
  id: number; title: string; version: string | null;
  sections: Section[]; questions: Question[]; eliminatory_locked: boolean;
}
interface Props { scriptId: number; onClose: () => void; onSaved: () => void }

export default function EliminatoriosModal({ scriptId, onClose, onSaved }: Props) {
  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [dimension, setDimension] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi(`/eval/scripts/${scriptId}`)
      .then((data: ScriptDetail) => {
        setScript(data);
        // pg devolve bigint como string → normaliza para number
        setMarked(new Set(data.questions.filter((q) => q.is_eliminatory).map((q) => Number(q.id))));
      })
      .catch((err: any) => setError(err.message || 'Erro ao carregar o roteiro.'));
  }, [scriptId]);

  const dimensions = useMemo(
    () => [...new Set((script?.questions ?? []).map((q) => q.dimension).filter(Boolean) as string[])].sort(),
    [script],
  );

  // Seções na ordem do documento (ids são sequenciais no import); critérios por order_index.
  const groups = useMemo(() => {
    if (!script) return [];
    return [...script.sections]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((s) => ({
        section: s,
        questions: script.questions
          .filter((q) => Number(q.section_id) === Number(s.id) && (!dimension || q.dimension === dimension))
          .sort((a, b) => a.order_index - b.order_index),
      }))
      .filter((g) => g.questions.length > 0);
  }, [script, dimension]);

  const locked = !!script?.eliminatory_locked;

  const toggle = (id: number) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetchApi(`/eval/scripts/${scriptId}/eliminatory`, {
        method: 'PATCH',
        body: JSON.stringify({ question_ids: [...marked] }),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar os critérios eliminatórios.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Critérios eliminatórios</h3>
            <p className="text-sm text-gray-500">
              {script ? `${script.title} — revisão ${script.version ?? '—'}` : 'Carregando…'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <p className="text-sm text-gray-600">
            A não conformidade em um critério eliminatório rebaixa o selo a <strong>Bronze</strong>,
            independentemente da nota, e torna o item obrigatório no plano de ação.
          </p>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {locked && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Este roteiro tem avaliações em ciclo aberto. As marcações só podem ser alteradas com o ciclo encerrado.</span>
            </div>
          )}
          {script && marked.size === 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Nenhum critério eliminatório marcado — o selo deste roteiro dependerá só da nota.</span>
            </div>
          )}

          {script && (
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-gray-700 flex items-center gap-2">
                Dimensão
                <select
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                >
                  <option value="">Todas</option>
                  {dimensions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <span className="text-sm font-medium text-gray-700">
                {marked.size} eliminatório{marked.size === 1 ? '' : 's'} de {script.questions.length} critérios
              </span>
            </div>
          )}

          {!script && !error && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          )}

          {groups.map(({ section, questions }) => (
            <fieldset key={String(section.id)} className="border border-gray-100 rounded-lg">
              <legend className="px-2 ml-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{section.name}</legend>
              <ul className="divide-y divide-gray-50">
                {questions.map((q) => {
                  const id = Number(q.id);
                  return (
                    <li key={id}>
                      <label className={`flex items-start gap-3 px-3 py-2 text-sm ${locked ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          className="mt-1 accent-[#00995D]"
                          checked={marked.has(id)}
                          disabled={locked}
                          onChange={() => toggle(id)}
                        />
                        {q.code && <span className="font-mono text-gray-500 flex-shrink-0">{q.code}</span>}
                        <span className="flex-1 text-gray-800">{q.text}</span>
                        {q.dimension && (
                          <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{q.dimension}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {locked ? 'Fechar' : 'Cancelar'}
          </button>
          {!locked && (
            <button
              type="button"
              disabled={!script || saving}
              onClick={handleSave}
              className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar no Admin**

Em `src/pages/Admin.tsx`:

1. Import, abaixo de `ConfirmDeleteRoteiroModal`: `import EliminatoriosModal from './qualificacao/EliminatoriosModal';` e acrescentar `ShieldAlert,` ao bloco de ícones do `lucide-react`.
2. Estado, junto de `deleteTarget`: `const [eliminatoriosTarget, setEliminatoriosTarget] = useState<number | null>(null);`
3. Botão reutilizável, no fim do arquivo (junto de `agruparPorRoteiro`):

```tsx
function EliminatoriosButton({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-gray-500 hover:text-[#00995D] p-1 flex-shrink-0"
      title="Critérios eliminatórios"
      aria-label="Critérios eliminatórios"
    >
      <ShieldAlert className={small ? 'w-4 h-4' : 'w-5 h-5'} />
    </button>
  );
}
```

4. Nos quatro pontos, colocar o botão **antes** da lixeira, embrulhando os dois num contêiner flex:
   - Card vigente (L673-679): embrulhar em `<div className="flex items-center gap-1 flex-shrink-0">` contendo `<EliminatoriosButton onClick={() => setEliminatoriosTarget(Number(vigente.id))} />` e o `<button ... Trash2>` existente.
   - Card revisão anterior (L721-727): `<div className="flex items-center gap-1 flex-shrink-0">` com `<EliminatoriosButton small onClick={() => setEliminatoriosTarget(Number(ant.id))} />` e a lixeira existente.
   - Lista vigente (L778-782): dentro do `<td>`, `<div className="flex items-center justify-center gap-1">` com `<EliminatoriosButton onClick={() => setEliminatoriosTarget(Number(vigente.id))} />` e a lixeira.
   - Lista revisão anterior (L796-800): idem, com `small` e `ant.id`.
5. No bloco de modais, depois do `ConfirmDeleteRoteiroModal`:

```tsx
      {eliminatoriosTarget != null && (
        <EliminatoriosModal
          scriptId={eliminatoriosTarget}
          onClose={() => setEliminatoriosTarget(null)}
          onSaved={loadData}
        />
      )}
```

- [ ] **Step 3: Typecheck e build**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run lint && npm run build`
Expected: ambos sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/pages/qualificacao/EliminatoriosModal.tsx src/pages/Admin.tsx
git commit -m "feat(admin): tela de critérios eliminatórios por roteiro"
```

---

### Task 8: Import abre a tela; preview mostra herança; alerta; limpeza

**Files:**
- Modify: `src/pages/qualificacao/ImportRoteiroModal.tsx` (tipos L5-28, `handleConfirm` L62-77, bloco de review ~L138)
- Modify: `src/pages/Admin.tsx:1257-1262`
- Modify: `src/pages/qualificacao/RoteiroAlerts.tsx`
- Modify: `src/pages/qualificacao/RoteiroPlayer.tsx:741-746`

**Interfaces:**
- Consumes: `preview.eliminatory` e `id` na resposta do import (Task 3); `alerts.semEliminatorio` (Task 4); `setEliminatoriosTarget` (Task 7).

- [ ] **Step 1: ImportRoteiroModal**

1. Em `PreviewResult`, depois de `warnings: {...};`:

```ts
  eliminatory?: {
    hasPrevious: boolean;
    inherited: number;
    lost: { code: string | null; text: string }[];
  };
```

2. Em `Props`: `onImported: (scriptId?: number) => void;`
3. Em `handleConfirm`, trocar as duas linhas do `await fetchApi(...)`/`onImported();` por:

```ts
      const data = await fetchApi('/eval/scripts/import', { method: 'POST', body: form });
      onImported(data?.id != null ? Number(data.id) : undefined);
```

4. No bloco de review, logo depois do `<div>` de "Dimensões":

```tsx
              {preview.eliminatory && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1">
                  <p className="font-medium text-gray-800">Critérios eliminatórios</p>
                  {preview.eliminatory.hasPrevious ? (
                    <p className="text-gray-600">
                      {preview.eliminatory.inherited} marcação(ões) herdada(s) da revisão vigente. Você poderá revisar na próxima tela.
                    </p>
                  ) : (
                    <p className="text-gray-600">
                      Roteiro novo: nenhum critério nasce eliminatório. Você escolherá os eliminatórios na próxima tela.
                    </p>
                  )}
                  {preview.eliminatory.lost.length > 0 && (
                    <div className="text-amber-800">
                      <p className="font-medium flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" /> Revisar: {preview.eliminatory.lost.length} marcação(ões) não transportada(s)
                      </p>
                      <p className="text-xs">Critério removido, com texto alterado ou ambíguo na revisão vigente:</p>
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {preview.eliminatory.lost.map((l, i) => (
                          <li key={`${l.code ?? '-'}-${i}`} className="flex gap-1.5">
                            {l.code && <span className="font-mono flex-shrink-0">{l.code}</span>}
                            <span>{l.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
```

- [ ] **Step 2: Admin abre a tela após importar**

Em `src/pages/Admin.tsx`, no `<ImportRoteiroModal ...>`:

```tsx
          onImported={(scriptId) => { loadData(); if (scriptId) setEliminatoriosTarget(scriptId); }}
```

- [ ] **Step 3: RoteiroAlerts**

Em `src/pages/qualificacao/RoteiroAlerts.tsx`:

```tsx
interface Alerts {
  semEvidencia: AlertItem[];
  semPeso: AlertItem[];
  semEliminatorio?: boolean;
}
```

Trocar o cálculo do total por:

```tsx
  const semEliminatorio = !!alerts?.semEliminatorio;
  const total = semEvidencia.length + semPeso.length + (semEliminatorio ? 1 : 0);
```

E, dentro do painel aberto, antes do grupo "Sem evidência":

```tsx
          {semEliminatorio && (
            <p className="text-xs font-semibold text-amber-800">
              Sem critérios eliminatórios — o selo deste roteiro depende só da nota.
            </p>
          )}
```

- [ ] **Step 4: Remover o badge morto**

Em `src/pages/qualificacao/RoteiroPlayer.tsx`, apagar as linhas 741-746 (o comentário `ponytail: badge DL acende...` e o bloco `{q.type === 'DL' && (...)}`). O badge "Eliminatório" logo abaixo fica.

- [ ] **Step 5: Typecheck e build**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run lint && npm run build`
Expected: ambos sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/pages/qualificacao/ImportRoteiroModal.tsx src/pages/Admin.tsx src/pages/qualificacao/RoteiroAlerts.tsx src/pages/qualificacao/RoteiroPlayer.tsx
git commit -m "feat(admin): import abre a tela de eliminatórios, preview mostra herança e alerta de roteiro sem eliminatório"
```

---

### Task 9: Verificação ponta a ponta (dev) e fechamento

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-criterios-eliminatorios-configuraveis-design.md` (linha de status)

- [ ] **Step 1: Suíte completa**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm test`
Expected: tudo PASS. (Rodar você mesmo — não delegar a subagente sem PATH.)

- [ ] **Step 2: Subir o dev server**

Usar o preview `dev` de `.claude/launch.json` (porta 3000) — nunca `npm run dev` via Bash. Login com um usuário `admin` ou `auditoria` é feito **pelo usuário** (o agente não digita senha).

- [ ] **Step 3: Roteiro no browser (Admin → Roteiros de Avaliação)**

Conferir, com evidência (texto da página / rede):
1. Um roteiro existente (ex.: FOR-001) abre a tela pelo ícone de escudo com os DL já marcados; desmarcar o CNES (1.1.5), salvar → `PATCH` 200 com `unmarked: 1`; reabrir confirma.
2. FOR-024 mostra o alerta "Sem critérios eliminatórios"; marcar 1.1.1–1.1.4, salvar → alerta some.
3. Desmarcar tudo num roteiro de teste (`rota-qualificacao/teste/`) → aviso amarelo na tela e alerta na lista.
4. Roteiro com avaliação em ciclo aberto (se houver ciclo ativo no dev): checkboxes desabilitados + banner; um `PATCH` forçado devolve 409.
5. Subir uma planilha de `rota-qualificacao/teste/` que ainda não exista no banco: preview mostra "Roteiro novo…", e ao confirmar a tela de eliminatórios abre sozinha, sem nada marcado.
6. `SELECT action, meta FROM access_logs WHERE action LIKE 'eval_%' ORDER BY created_at DESC LIMIT 5;` mostra `eval_eliminatory_changed` e `eval_script_imported`.
7. Console do browser sem erros.

Restaurar ao final as marcações alteradas só para teste (itens 1-3), a menos que a Katy queira mantê-las.

- [ ] **Step 4: Fechar a spec**

Na spec, trocar `Status: desenho fechado, não implementado.` por `Status: implementado no dev em <data>; marcações de homolog/prod são refeitas à mão na promoção.`

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-21-criterios-eliminatorios-configuraveis-design.md docs/superpowers/plans/2026-09-21-criterios-eliminatorios-configuraveis.md CONTEXT.md
git commit -m "docs(qualificacao): spec, plano e glossário dos critérios eliminatórios configuráveis"
```

---

## Notas para a promoção (homolog/prod)

- Sem migration. Depois do deploy, **refazer as marcações à mão** em cada ambiente: no mínimo marcar os alvarás/ART do FOR-024 (hoje sem nenhum eliminatório) e revisar CNES / DL do FOR-011 conforme a Unimed decidir.
- Pendência à parte (fora deste plano): verificar se o DL bypass alcança hospitais — os alvarás do FOR-024 estão na dimensão "Segurança" e o `document_type` só é extraído para "Documento Legal" (`db/roteiro-parser.ts:244`).
