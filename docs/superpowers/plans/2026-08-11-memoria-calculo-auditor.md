# Memória de Cálculo (Auditor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel de memória de cálculo no AuditorPlayer que mostra, por prestador, o cálculo linha a linha (por dimensão), os itens fora do cálculo e o rollup até nota/selo — live e read-only.

**Architecture:** A regra de pontuação vira uma função pura única (`buildScoreMemory`) reusada pelo `/parecer` (fonte única, impossível divergir) e por um novo endpoint `GET /eval/instances/:id/memoria-calculo`. Um modal no AuditorPlayer consome o endpoint.

**Tech Stack:** TypeScript, Express (`server.ts`), React (`src/pages/qualificacao`), testes com `node:test` + `tsx`.

## Global Constraints

- Node/npm rodam via `/c/Program Files/nodejs/node`; testes: `node --import tsx --test <arquivo>`; typecheck: `npx tsc --noEmit`.
- Selo vem de `computeSeal(percentual, hasEliminatoryFailed)` → `'Ouro' | 'Prata' | 'Bronze'` (nunca "Não Qualificado"; esse rótulo é só do dashboard).
- Base = `round(obtido/máx * 10000) / 100` (2 casas). Nota final = `min(100, base + bônus)`. Bônus = `10` se pesquisa no prazo, senão `0`.
- Dimensão: `Documento Legal` consolida em `Segurança`.
- N/A **aprovado** sai do cálculo; N/A **reprovado** conta 0; sem-resposta sai. (mesma regra de `COUNTS_IN_SCORE_SQL`).
- Endpoints de qualificação são staff-only: `if (!isStaff(req.user.role)) return res.status(403)...`.
- Não há harness de integração para endpoints/React; tarefas de endpoint e UI verificam por `tsc --noEmit` + smoke manual no preview. A lógica de cálculo é TDD puro.

---

### Task 1: Função pura `buildScoreMemory` + testes

**Files:**
- Create: `src/lib/scoreMemory.ts`
- Test: `src/lib/scoreMemory.test.ts`
- Modify: `package.json` (script `test`, acrescentar o arquivo)

**Interfaces:**
- Consumes: `computeSeal` de `src/lib/computeSeal.js`.
- Produces:
  - `ScoreMemoryRow = { question_id: number; code: string | null; dimension: string | null; is_eliminatory: boolean; max_score: number; answer_value: string | null; score_obtained: number | null; evidence_status: string | null }`
  - `ScoreMemorySurvey = { within_deadline: boolean }`
  - `buildScoreMemory(rows: ScoreMemoryRow[], survey: ScoreMemorySurvey | null): ScoreMemory`
  - `ScoreMemory = { criteria: ScoreMemoryCriterion[]; dimensions: { dimension: string; obtained: number; max: number; pct: number }[]; out_of_calc: { na_aprovado: string[]; sem_resposta: string[] }; totals: { obtained: number; max: number; base_pct: number }; bonus: number; bonus_pending: boolean; final_pct: number; eliminatory_failed: boolean; seal: string }`
  - `ScoreMemoryCriterion = { question_id: number; code: string | null; dimension: string; is_eliminatory: boolean; answer_value: string | null; evidence_status: string | null; obtained: number; max: number; classification: 'conta' | 'na_aprovado' | 'sem_resposta' }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/scoreMemory.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreMemory, type ScoreMemoryRow } from './scoreMemory.js';

function row(over: Partial<ScoreMemoryRow> = {}): ScoreMemoryRow {
  return {
    question_id: over.question_id ?? 1,
    code: over.code ?? 'X',
    dimension: over.dimension ?? 'Conforto',
    is_eliminatory: over.is_eliminatory ?? false,
    max_score: over.max_score ?? 10,
    answer_value: over.answer_value ?? 'sim',
    score_obtained: over.score_obtained ?? 10,
    evidence_status: over.evidence_status ?? 'aprovado',
  };
}

test('sim/aprovado conta pontos; nao/aprovado conta 0; ambos no denominador', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', answer_value: 'sim', score_obtained: 10, max_score: 10 }),
    row({ question_id: 2, code: 'B', answer_value: 'nao', score_obtained: 0, max_score: 10 }),
  ], null);
  assert.equal(m.totals.obtained, 10);
  assert.equal(m.totals.max, 20);
  assert.equal(m.totals.base_pct, 50);
});

test('N/A aprovado sai do calculo; N/A reprovado conta 0 no denominador', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', answer_value: 'sim', score_obtained: 10, max_score: 10 }),
    row({ question_id: 2, code: 'NAOK', answer_value: 'na', evidence_status: 'aprovado', score_obtained: 0, max_score: 10 }),
    row({ question_id: 3, code: 'NAREP', answer_value: 'na', evidence_status: 'reprovado', score_obtained: 0, max_score: 10 }),
  ], null);
  assert.equal(m.totals.max, 20);            // 10 (A) + 10 (NAREP); NAOK fora
  assert.equal(m.totals.obtained, 10);
  assert.deepEqual(m.out_of_calc.na_aprovado, ['NAOK']);
  assert.equal(m.criteria.find(c => c.code === 'NAREP')!.classification, 'conta');
});

test('sem resposta (answer_value nulo) sai do calculo e aparece em out_of_calc', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', answer_value: 'sim', score_obtained: 8, max_score: 10 }),
    row({ question_id: 2, code: 'VAZIO', answer_value: null, score_obtained: null, max_score: 10 }),
  ], null);
  assert.equal(m.totals.max, 10);
  assert.deepEqual(m.out_of_calc.sem_resposta, ['VAZIO']);
});

test('Documento Legal consolida em Seguranca', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'S1', dimension: 'Segurança', score_obtained: 5, max_score: 10 }),
    row({ question_id: 2, code: 'DL1', dimension: 'Documento Legal', score_obtained: 10, max_score: 10 }),
  ], null);
  const seg = m.dimensions.find(d => d.dimension === 'Segurança')!;
  assert.equal(seg.obtained, 15);
  assert.equal(seg.max, 20);
  assert.equal(m.dimensions.some(d => d.dimension === 'Documento Legal'), false);
});

test('bonus +10 no prazo, teto 100, e seal via computeSeal', () => {
  const rows = [row({ question_id: 1, code: 'A', score_obtained: 10, max_score: 10 })]; // base 100
  const semBonus = buildScoreMemory(rows, { within_deadline: false });
  assert.equal(semBonus.bonus, 0);
  assert.equal(semBonus.final_pct, 100);
  assert.equal(semBonus.seal, 'Ouro');
  const comBonus = buildScoreMemory(rows, { within_deadline: true });
  assert.equal(comBonus.final_pct, 100);      // teto 100 (100+10 -> 100)
  const semSurvey = buildScoreMemory(rows, null);
  assert.equal(semSurvey.bonus_pending, true);
});

test('eliminatorio reprovado rebaixa selo a Bronze', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', score_obtained: 10, max_score: 10 }),
    row({ question_id: 2, code: 'ELIM', is_eliminatory: true, answer_value: 'nao', evidence_status: 'reprovado', score_obtained: 0, max_score: 10 }),
  ], { within_deadline: false });
  assert.equal(m.eliminatory_failed, true);
  assert.equal(m.seal, 'Bronze');
});

test('paridade com a formula do parecer (base/final/seal)', () => {
  const rows: ScoreMemoryRow[] = [
    row({ question_id: 1, code: 'A', dimension: 'Segurança', score_obtained: 7, max_score: 10 }),
    row({ question_id: 2, code: 'B', dimension: 'Conforto', answer_value: 'nao', score_obtained: 0, max_score: 10 }),
    row({ question_id: 3, code: 'C', dimension: 'Experiência do Cliente', score_obtained: 9, max_score: 10 }),
    row({ question_id: 4, code: 'D', answer_value: 'na', evidence_status: 'aprovado', score_obtained: 0, max_score: 10 }),
  ];
  const survey = { within_deadline: true };
  // Referencia = formula atual do /parecer.
  const counted = rows.filter(r => !(String(r.answer_value).toLowerCase() === 'na' && r.evidence_status === 'aprovado') && r.answer_value);
  const score = counted.reduce((s, r) => s + (r.score_obtained ?? 0), 0);
  const max = counted.reduce((s, r) => s + r.max_score, 0);
  const base = max > 0 ? Math.round((score / max) * 10000) / 100 : 0;
  const final = Math.min(100, base + (survey.within_deadline ? 10 : 0));
  const m = buildScoreMemory(rows, survey);
  assert.equal(m.totals.base_pct, base);
  assert.equal(m.final_pct, final);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/scoreMemory.test.ts`
Expected: FAIL — `Cannot find module './scoreMemory.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/scoreMemory.ts`:

```ts
import { computeSeal } from './computeSeal.js';

export interface ScoreMemoryRow {
  question_id: number;
  code: string | null;
  dimension: string | null;
  is_eliminatory: boolean;
  max_score: number;
  answer_value: string | null;
  score_obtained: number | null;
  evidence_status: string | null;
}

export interface ScoreMemorySurvey { within_deadline: boolean }

export type Classification = 'conta' | 'na_aprovado' | 'sem_resposta';

export interface ScoreMemoryCriterion {
  question_id: number;
  code: string | null;
  dimension: string;
  is_eliminatory: boolean;
  answer_value: string | null;
  evidence_status: string | null;
  obtained: number;
  max: number;
  classification: Classification;
}

export interface ScoreMemory {
  criteria: ScoreMemoryCriterion[];
  dimensions: { dimension: string; obtained: number; max: number; pct: number }[];
  out_of_calc: { na_aprovado: string[]; sem_resposta: string[] };
  totals: { obtained: number; max: number; base_pct: number };
  bonus: number;
  bonus_pending: boolean;
  final_pct: number;
  eliminatory_failed: boolean;
  seal: string;
}

// Documento Legal soma dentro de Segurança; sem dimensão vira 'Outros'.
function consolidate(dim: string | null): string {
  if (dim === 'Documento Legal' || dim === 'Segurança') return 'Segurança';
  return dim ?? 'Outros';
}

function classify(r: ScoreMemoryRow): Classification {
  const v = (r.answer_value ?? '').toLowerCase();
  if (!v) return 'sem_resposta';
  if (v === 'na' && r.evidence_status === 'aprovado') return 'na_aprovado';
  return 'conta';
}

export function buildScoreMemory(
  rows: ScoreMemoryRow[],
  survey: ScoreMemorySurvey | null,
): ScoreMemory {
  const criteria: ScoreMemoryCriterion[] = rows.map(r => ({
    question_id: r.question_id,
    code: r.code,
    dimension: consolidate(r.dimension),
    is_eliminatory: r.is_eliminatory,
    answer_value: r.answer_value,
    evidence_status: r.evidence_status,
    obtained: Number(r.score_obtained ?? 0),
    max: Number(r.max_score),
    classification: classify(r),
  }));

  const dimMap = new Map<string, { obtained: number; max: number }>();
  let obtained = 0, max = 0;
  for (const c of criteria) {
    if (c.classification !== 'conta') continue;
    obtained += c.obtained;
    max += c.max;
    const d = dimMap.get(c.dimension) ?? { obtained: 0, max: 0 };
    d.obtained += c.obtained; d.max += c.max;
    dimMap.set(c.dimension, d);
  }

  const dimensions = Array.from(dimMap.entries()).map(([dimension, v]) => ({
    dimension, obtained: v.obtained, max: v.max,
    pct: v.max > 0 ? Math.round((v.obtained / v.max) * 1000) / 10 : 0,
  }));

  const base_pct = max > 0 ? Math.round((obtained / max) * 10000) / 100 : 0;
  const bonus = survey?.within_deadline ? 10 : 0;
  const final_pct = Math.min(100, base_pct + bonus);
  const eliminatory_failed = criteria.some(c => c.evidence_status === 'reprovado' && c.is_eliminatory);

  return {
    criteria,
    dimensions,
    out_of_calc: {
      na_aprovado: criteria.filter(c => c.classification === 'na_aprovado').map(c => c.code ?? '—'),
      sem_resposta: criteria.filter(c => c.classification === 'sem_resposta').map(c => c.code ?? '—'),
    },
    totals: { obtained, max, base_pct },
    bonus,
    bonus_pending: survey == null,
    final_pct,
    eliminatory_failed,
    seal: computeSeal(final_pct, eliminatory_failed),
  };
}
```

- [ ] **Step 4: Add the test file to the `test` script**

In `package.json`, no fim da lista do script `test`, trocar:

```
src/lib/actionPlan.test.ts src/lib/certValidity.test.ts src/lib/providerEdit.test.ts"
```

por:

```
src/lib/actionPlan.test.ts src/lib/certValidity.test.ts src/lib/providerEdit.test.ts src/lib/scoreMemory.test.ts"
```

- [ ] **Step 5: Run tests and typecheck**

Run: `node --import tsx --test src/lib/scoreMemory.test.ts`
Expected: PASS (7 tests).
Run: `npx tsc --noEmit 2>&1 | grep -i scoreMemory; echo done`
Expected: só `done` (sem erros).

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoreMemory.ts src/lib/scoreMemory.test.ts package.json
git commit -m "feat(qualificacao): buildScoreMemory (regra unica de pontuacao)"
```

---

### Task 2: Convergir `/parecer` para `buildScoreMemory`

**Files:**
- Modify: `server.ts` (endpoint `POST /api/eval/instances/:id/parecer`, bloco `totals` + math inline)

**Interfaces:**
- Consumes: `buildScoreMemory`, `ScoreMemoryRow` (Task 1).
- Produces: nenhum novo símbolo. `percentual`/`seal`/`hasEliminatoryFailed`/`score`/`maxPossible` seguem existindo como variáveis locais para o restante do handler (plano de ação, UPDATE, certificado).

- [ ] **Step 1: Add the static import**

No topo do `server.ts`, logo após a linha `import { PROVIDER_EDIT_STATUSES, providerCanEditCriterion } from './src/lib/providerEdit.js';`, adicionar:

```ts
import { buildScoreMemory } from './src/lib/scoreMemory.js';
```

- [ ] **Step 2: Replace the totals query + inline math**

No handler do parecer, trocar este bloco:

```ts
      const { rows: [totals] } = await query(`
        SELECT
          COALESCE(SUM(ea.score_obtained) FILTER (WHERE ${COUNTS_IN_SCORE_SQL}), 0)::numeric AS score,
          COALESCE(SUM(eq.max_score)      FILTER (WHERE ${COUNTS_IN_SCORE_SQL}), 0)::numeric AS max_possible,
          COALESCE(BOOL_OR(ea.evidence_status = 'reprovado' AND eq.is_eliminatory), false) AS elim_fail
        FROM eval_answers ea
        JOIN eval_questions eq ON eq.id = ea.question_id
        WHERE ea.instance_id = $1
      `, [id]);

      const score = Number(totals.score);
      const maxPossible = Number(totals.max_possible);
      const percentualBase = maxPossible > 0 ? Math.round((score / maxPossible) * 10000) / 100 : 0;
      const hasEliminatoryFailed = !!totals.elim_fail;

      // Bônus da pesquisa: +10 (teto 100) se respondida no prazo (spec 5.4.6).
      const bonus = survey?.within_deadline ? 10 : 0;
      const percentual = Math.min(100, percentualBase + bonus);

      const { computeSeal } = await import('./src/lib/computeSeal.js');
      const seal = computeSeal(percentual, hasEliminatoryFailed);
```

por:

```ts
      // Mesma regra da memória de cálculo (fonte única em scoreMemory.ts).
      const { rows: memRows } = await query(`
        SELECT ea.question_id, eq.code, eq.dimension, eq.is_eliminatory, eq.max_score,
               ea.answer_value, ea.score_obtained, ea.evidence_status
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
         WHERE ea.instance_id = $1
      `, [id]);
      const mem = buildScoreMemory(
        memRows.map((r: any) => ({
          question_id: Number(r.question_id), code: r.code, dimension: r.dimension,
          is_eliminatory: !!r.is_eliminatory, max_score: Number(r.max_score),
          answer_value: r.answer_value, score_obtained: r.score_obtained,
          evidence_status: r.evidence_status,
        })),
        survey?.within_deadline != null ? { within_deadline: !!survey.within_deadline } : null,
      );
      const score = mem.totals.obtained;
      const maxPossible = mem.totals.max;
      const hasEliminatoryFailed = mem.eliminatory_failed;
      const percentual = mem.final_pct;
      const seal = mem.seal;
```

> Nota: **não** declarar `percentualBase` nem `bonus` — não são usados depois deste bloco (a nota já vem pronta em `mem.final_pct`); declará-los quebra o build se `noUnusedLocals` estiver ligado. As variáveis usadas adiante (UPDATE, auditLog, `res.json`) são exatamente `score`, `maxPossible`, `percentual`, `seal`, `hasEliminatoryFailed`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i 'server.ts'; echo done`
Expected: só `done` (sem erros). Se aparecer "computeSeal is declared but never used" ou similar, remover o `import('./src/lib/computeSeal.js')` órfão — ele foi eliminado no Step 2.

- [ ] **Step 4: Re-run the pure tests (paridade)**

Run: `node --import tsx --test src/lib/scoreMemory.test.ts`
Expected: PASS — o teste "paridade com a formula do parecer" garante que `buildScoreMemory` reproduz a conta antiga.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "refactor(parecer): usa buildScoreMemory (elimina duplicacao da regra)"
```

---

### Task 3: Endpoint `GET /eval/instances/:id/memoria-calculo`

**Files:**
- Modify: `server.ts` (adicionar a rota logo após o handler do `parecer`, antes do próximo `app.get`/`app.post`)

**Interfaces:**
- Consumes: `buildScoreMemory`, `isStaff`, `query` (já disponíveis).
- Produces: resposta JSON `ScoreMemory & { stored?: { percentual: number; seal: string | null } }`.

- [ ] **Step 1: Add the route**

Localizar o fim do handler `app.post('/api/eval/instances/:id/parecer', ...)` (termina com `});` seguido de linha em branco) e inserir logo depois:

```ts
  // Memória de cálculo detalhada (auditor) — mesma regra do parecer, sem gravar nada.
  app.get('/api/eval/instances/:id/memoria-calculo', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: [inst] } = await query(
        'SELECT id, status, script_id, percentual, seal FROM eval_instances WHERE id = $1', [id]);
      if (!inst) return res.status(404).json({ error: 'instance not found' });

      const { rows: [survey] } = await query(
        'SELECT within_deadline FROM eval_survey_responses WHERE instance_id = $1', [id]);

      // LEFT JOIN a partir das questões do roteiro: questões nunca respondidas
      // aparecem como 'sem_resposta'. buildScoreMemory é agnóstico a linha faltante.
      const { rows: memRows } = await query(`
        SELECT eq.id AS question_id, eq.code, eq.dimension, eq.is_eliminatory, eq.max_score,
               ea.answer_value, ea.score_obtained, ea.evidence_status
          FROM eval_questions eq
          JOIN eval_sections sc ON sc.id = eq.section_id
          LEFT JOIN eval_answers ea ON ea.instance_id = $1 AND ea.question_id = eq.id
         WHERE sc.script_id = $2
         ORDER BY eq.dimension NULLS LAST, eq.code
      `, [id, inst.script_id]);

      const mem = buildScoreMemory(
        memRows.map((r: any) => ({
          question_id: Number(r.question_id), code: r.code, dimension: r.dimension,
          is_eliminatory: !!r.is_eliminatory, max_score: Number(r.max_score),
          answer_value: r.answer_value, score_obtained: r.score_obtained,
          evidence_status: r.evidence_status,
        })),
        survey ? { within_deadline: !!survey.within_deadline } : null,
      );

      const CLOSED = ['aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado'];
      const payload: any = { ...mem };
      if (CLOSED.includes(inst.status)) {
        payload.stored = { percentual: Number(inst.percentual) || 0, seal: inst.seal };
      }
      res.json(payload);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i 'server.ts'; echo done`
Expected: só `done`.

- [ ] **Step 3: Smoke manual no preview**

Subir o dev (`preview_start name=dev`), logar como auditor, abrir DevTools → Network, abrir uma instância no painel e chamar (via console) `fetch('/api/eval/instances/<id>/memoria-calculo', {credentials:'include'}).then(r=>r.json()).then(console.log)`.
Expected: JSON com `criteria`, `dimensions`, `out_of_calc`, `totals`, `final_pct`, `seal`; e `stored` quando a instância está fechada.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(qualificacao): endpoint GET memoria-calculo"
```

---

### Task 4: Componente `MemoriaCalculoModal`

**Files:**
- Create: `src/pages/qualificacao/MemoriaCalculoModal.tsx`

**Interfaces:**
- Consumes: `fetchApi` de `../../lib/api`; endpoint da Task 3.
- Produces: `export default function MemoriaCalculoModal({ instanceId, onClose }: { instanceId: number; onClose: () => void })`.

- [ ] **Step 1: Create the component**

Create `src/pages/qualificacao/MemoriaCalculoModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, Loader2, AlertTriangle } from 'lucide-react';

const answerLabel = (v: string | null) =>
  v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : v === 'na' ? 'N/A' : '—';

const classPill: Record<string, { label: string; cls: string }> = {
  conta:       { label: 'Conta',  cls: 'bg-emerald-50 text-emerald-700' },
  na_aprovado: { label: 'Fora — N/A aprovado', cls: 'bg-gray-100 text-gray-600' },
  sem_resposta:{ label: 'Fora — sem resposta', cls: 'bg-gray-100 text-gray-600' },
};

export default function MemoriaCalculoModal({ instanceId, onClose }: { instanceId: number; onClose: () => void }) {
  const [mem, setMem] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setMem(await fetchApi(`/eval/instances/${instanceId}/memoria-calculo`)); }
      catch (e: any) { alert(e?.message || 'Erro ao carregar memória de cálculo'); }
      finally { setLoading(false); }
    })();
  }, [instanceId]);

  const headlinePct = mem?.stored ? mem.stored.percentual : mem?.final_pct;
  const headlineSeal = mem?.stored ? mem.stored.seal : mem?.seal;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-secondary-900">Memória de cálculo</h2>
            {mem?.stored && <p className="text-xs text-gray-500">Valores oficiais gravados no parecer.</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        {loading || !mem ? (
          <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <span className="text-2xl font-bold text-secondary-900">{Number(headlinePct).toFixed(2)}%</span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">{headlineSeal || '—'}</span>
              {mem.eliminatory_failed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Reprovado em critério eliminatório
                </span>
              )}
            </div>

            {mem.dimensions.map((dim: any) => (
              <section key={dim.dimension} className="mb-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-sm font-bold text-secondary-900">{dim.dimension}</h3>
                  <span className="text-xs font-semibold text-gray-600">{dim.obtained}/{dim.max} · {dim.pct}%</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500">
                        <th className="py-1 pr-2">Cód.</th><th className="py-1 pr-2">Resposta</th>
                        <th className="py-1 pr-2">Obtido/Máx</th><th className="py-1 pr-2">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mem.criteria.filter((c: any) => c.dimension === dim.dimension && c.classification === 'conta').map((c: any) => (
                        <tr key={c.question_id} className="border-b border-gray-50">
                          <td className="py-1 pr-2 font-mono text-xs">{c.code || '—'}{c.is_eliminatory ? ' ⛔' : ''}</td>
                          <td className="py-1 pr-2">{answerLabel(c.answer_value)}</td>
                          <td className="py-1 pr-2 tabular-nums">{c.obtained}/{c.max}</td>
                          <td className="py-1 pr-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${classPill[c.classification].cls}`}>{classPill[c.classification].label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            {(mem.out_of_calc.na_aprovado.length > 0 || mem.out_of_calc.sem_resposta.length > 0) && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                <p className="font-semibold text-gray-700">Fora do cálculo (não entram no denominador)</p>
                {mem.out_of_calc.na_aprovado.length > 0 && <p className="mt-1">N/A aprovado: {mem.out_of_calc.na_aprovado.join(', ')}</p>}
                {mem.out_of_calc.sem_resposta.length > 0 && <p className="mt-1">Sem resposta: {mem.out_of_calc.sem_resposta.join(', ')}</p>}
              </div>
            )}

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-secondary-900">
              <div className="flex justify-between"><span>Base (Σ obtido / Σ máx)</span><span className="font-semibold tabular-nums">{mem.totals.obtained}/{mem.totals.max} = {mem.totals.base_pct}%</span></div>
              <div className="flex justify-between"><span>Bônus da pesquisa</span><span className="font-semibold tabular-nums">{mem.bonus_pending ? '0 (pesquisa pendente)' : `+${mem.bonus}`}</span></div>
              <div className="mt-1 flex justify-between border-t border-emerald-200 pt-1 text-base font-bold"><span>Nota final (teto 100)</span><span className="tabular-nums">{mem.final_pct}%</span></div>
              <div className="flex justify-between"><span>Selo</span><span className="font-semibold">{mem.seal}</span></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i 'MemoriaCalculoModal'; echo done`
Expected: só `done`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/qualificacao/MemoriaCalculoModal.tsx
git commit -m "feat(qualificacao): MemoriaCalculoModal"
```

---

### Task 5: Botão no AuditorPlayer + render do modal

**Files:**
- Modify: `src/pages/qualificacao/AuditorPlayer.tsx`

**Interfaces:**
- Consumes: `MemoriaCalculoModal` (Task 4).

- [ ] **Step 1: Import the modal**

No topo de `AuditorPlayer.tsx`, após `import { statusLabel } from '../../lib/statusLabels';` **não existe aqui** — usar a linha existente `import { ITEM_STATUS_LABEL } from './planoStatus';` como âncora e adicionar logo depois:

```tsx
import MemoriaCalculoModal from './MemoriaCalculoModal';
```

- [ ] **Step 2: Add state**

Localizar `const [planSaving, setPlanSaving] = useState(false);` e adicionar logo depois:

```tsx
  const [showMemoria, setShowMemoria] = useState(false);
```

- [ ] **Step 3: Add the header button**

No header, localizar o bloco que decide entre o selo read-only e o botão "Emitir Parecer Final":

```tsx
            {readOnly ? (
              <span className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-500">
                <ShieldCheck className="h-4 w-4" /> Avaliação encerrada — somente leitura
              </span>
            ) : (
```

Trocar essa linha de abertura por um wrapper com o botão de memória sempre visível:

```tsx
            <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMemoria(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" /> Memória de cálculo
            </button>
            {readOnly ? (
              <span className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-500">
                <ShieldCheck className="h-4 w-4" /> Avaliação encerrada — somente leitura
              </span>
            ) : (
```

E fechar o novo `<div>`: localizar o fechamento desse condicional (a linha `)}` que fecha o `{readOnly ? (...) : (...)}` logo antes de `</div>` que encerra `md:items-end`) e acrescentar `</div>` após ele. Concretamente, o bloco que hoje é:

```tsx
              </button>
            )}
          </div>
        </div>
      </header>
```

vira:

```tsx
              </button>
            )}
            </div>
          </div>
        </div>
      </header>
```

- [ ] **Step 4: Render the modal**

Localizar o render do `PlanoAcaoModal` no fim do componente:

```tsx
      {planCandidates && (
        <PlanoAcaoModal
          candidates={planCandidates}
          checked={planChecked}
          setChecked={setPlanChecked}
          saving={planSaving}
          onCancel={() => setPlanCandidates(null)}
          onConfirm={confirmParecerComPlano}
        />
      )}
```

Adicionar logo depois:

```tsx
      {showMemoria && (
        <MemoriaCalculoModal instanceId={instanceId} onClose={() => setShowMemoria(false)} />
      )}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit 2>&1 | grep -i 'AuditorPlayer'; echo done`
Expected: só `done`.
Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 6: Smoke manual no preview**

Subir o dev, abrir uma instância (aba "Analisar"/"Visualizar"), clicar em "Memória de cálculo": o modal abre com cabeçalho (nota/selo), tabelas por dimensão, fora-do-cálculo e rodapé. Testar numa instância **fechada** (headline = valores gravados) e numa **em análise** (projeção). Screenshot pra evidência.

- [ ] **Step 7: Commit**

```bash
git add src/pages/qualificacao/AuditorPlayer.tsx
git commit -m "feat(qualificacao): botao Memoria de calculo no AuditorPlayer"
```

---

## Notas de verificação final (antes do push)

- `node --import tsx --test src/lib/scoreMemory.test.ts` verde.
- `npx tsc --noEmit` sem novos erros em `server.ts`, `scoreMemory.ts`, `MemoriaCalculoModal.tsx`, `AuditorPlayer.tsx`.
- `npm run build` ok (frontend rebuilda no deploy via nixpacks).
- Smoke: uma instância fechada e uma em análise mostram a memória corretamente; a nota do rodapé bate com a coluna Pontuação do painel para instâncias finalizadas.
- Sem migration (nada de schema novo).
