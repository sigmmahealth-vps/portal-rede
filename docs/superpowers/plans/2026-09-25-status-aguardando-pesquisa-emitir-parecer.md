# Status "Aguardando Pesquisa" e "Emitir Parecer Final" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar dois status calculados no roteiro — "Aguardando Pesquisa" e "Emitir Parecer Final" — no Painel do Ciclo (auditor) e na tela do prestador, sem gravar nada novo no banco.

**Architecture:** Uma função pura `displayStatus` (em `src/lib/auditorDashboard.ts`) deriva o status mostrado a partir do status gravado, da contagem de critérios sem decisão e do estado da Pesquisa de Satisfação. O servidor só passa a devolver `pending_count` (mesmo predicado do parecer, numa constante SQL compartilhada) e `has_survey_response`; o painel recebe `display_status` pronto e o prestador calcula na tela.

**Tech Stack:** TypeScript, React 19 + Tailwind, Express + `pg` (server.ts), testes `node:test` via `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-25-status-aguardando-pesquisa-emitir-parecer-design.md`

## Global Constraints

- **Sem migration**; `eval_instances.status` gravado não muda em lugar nenhum.
- Rótulos exatos: `aguardando_pesquisa` → **Aguardando Pesquisa**; `emitir_parecer` → **Emitir Parecer Final**.
- Critério decidido = `evidence_status IN ('aprovado','reprovado','nao_se_aplica')`; a contagem de pendentes usa **o mesmo predicado `NOT IN` do parecer** (não conta `NULL`).
- Prazo da pesquisa = `isWithinDeadline` de `src/lib/surveyBonus.ts` (borda exata dos 7 dias = ainda dentro).
- Prestador nunca vê `emitir_parecer` (vê `em_analise`).
- **Ambiente:** Node fora do PATH. Em Bash, prefixe: `export PATH="/c/Program Files/nodejs:$PATH"`. Rode tudo dentro de `portal-rede-v1-main/`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: `displayStatus` + rótulos

**Files:**
- Modify: `src/lib/auditorDashboard.ts` (nova função exportada, logo após `surveyState`)
- Modify: `src/lib/statusLabels.ts` (2 entradas novas)
- Test: `src/lib/auditorDashboard.test.ts` (testes novos no fim)

**Interfaces:**
- Produces: `displayStatus(status: string, pendingCount: number, submittedAt: string | null | undefined, hasSurveyResponse: boolean | undefined, now: Date, audience?: 'auditor' | 'prestador'): string` — retorna o próprio `status`, `'aguardando_pesquisa'`, `'emitir_parecer'` ou (prestador) `'em_analise'`.
- Produces: `STATUS_LABEL.aguardando_pesquisa = 'Aguardando Pesquisa'`, `STATUS_LABEL.emitir_parecer = 'Emitir Parecer Final'`.

- [ ] **Step 1: Write the failing test** — acrescente ao fim de `src/lib/auditorDashboard.test.ts` e ajuste o import da linha 3 para `import { buildAuditorDashboard, displayStatus, type DashboardInstance, type DimPct } from './auditorDashboard.js';`

```ts
test('displayStatus: regra de Aguardando Pesquisa / Emitir Parecer Final', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const sent2d = '2026-09-09T12:00:00Z';   // dentro dos 7 dias
  const sent10d = '2026-09-01T12:00:00Z';  // prazo vencido
  const edge = '2026-09-04T12:00:00Z';     // exatamente 7 dias antes de now → ainda dentro

  // Critério pendente: status gravado não muda.
  assert.equal(displayStatus('em_analise', 2, sent2d, false, now), 'em_analise');
  assert.equal(displayStatus('aguardando_evidencia', 1, sent2d, true, now), 'aguardando_evidencia');
  // Tudo decidido + pesquisa travando.
  assert.equal(displayStatus('em_analise', 0, sent2d, false, now), 'aguardando_pesquisa');
  assert.equal(displayStatus('em_analise', 0, edge, false, now), 'aguardando_pesquisa');
  // Tudo decidido + pesquisa liberada (respondida, vencida ou sem data de envio).
  assert.equal(displayStatus('em_analise', 0, sent2d, true, now), 'emitir_parecer');
  assert.equal(displayStatus('em_analise', 0, sent10d, false, now), 'emitir_parecer');
  assert.equal(displayStatus('em_analise', 0, null, false, now), 'emitir_parecer');
  assert.equal(displayStatus('aguardando_evidencia', 0, sent2d, true, now), 'emitir_parecer');
  // Outros status nunca mudam.
  for (const s of ['pendente', 'em_andamento', 'aprovado', 'ciclo_encerrado']) {
    assert.equal(displayStatus(s, 0, sent10d, true, now), s);
  }
  // Prestador: Emitir Parecer Final vira Em Análise; Aguardando Pesquisa se mantém.
  assert.equal(displayStatus('em_analise', 0, sent2d, true, now, 'prestador'), 'em_analise');
  assert.equal(displayStatus('aguardando_evidencia', 0, sent2d, true, now, 'prestador'), 'em_analise');
  assert.equal(displayStatus('em_analise', 0, sent2d, false, now, 'prestador'), 'aguardando_pesquisa');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/auditorDashboard.test.ts`
Expected: FAIL — `displayStatus` não é exportado (SyntaxError / "does not provide an export named 'displayStatus'").

- [ ] **Step 3: Write minimal implementation** — em `src/lib/auditorDashboard.ts`, logo após o fim de `surveyState`:

```ts
// Status mostrado ao usuário (spec 2026-09-25) — calculado, nunca gravado.
// Só muda em_analise/aguardando_evidencia com TODOS os critérios decididos:
// pesquisa ainda travando o parecer → 'aguardando_pesquisa'; senão → 'emitir_parecer'
// (mesmas travas do POST /parecer). O prestador não vê 'emitir_parecer' (etapa interna).
export function displayStatus(
  status: string,
  pendingCount: number,
  submittedAt: string | null | undefined,
  hasSurveyResponse: boolean | undefined,
  now: Date,
  audience: 'auditor' | 'prestador' = 'auditor',
): string {
  if (!['em_analise', 'aguardando_evidencia'].includes(status) || pendingCount > 0) return status;
  if (!hasSurveyResponse && submittedAt && isWithinDeadline(new Date(submittedAt), now)) return 'aguardando_pesquisa';
  return audience === 'prestador' ? 'em_analise' : 'emitir_parecer';
}
```

E em `src/lib/statusLabels.ts`, dentro de `STATUS_LABEL`, após `aguardando_evidencia`:

```ts
  aguardando_pesquisa:   'Aguardando Pesquisa',   // calculado (spec 2026-09-25)
  emitir_parecer:        'Emitir Parecer Final',  // calculado (spec 2026-09-25)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/auditorDashboard.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auditorDashboard.ts src/lib/auditorDashboard.test.ts src/lib/statusLabels.ts
git commit -m "feat(qualificacao): displayStatus calcula Aguardando Pesquisa / Emitir Parecer Final" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Painel do Ciclo — dados (`pending_count` → `display_status`)

**Files:**
- Modify: `server.ts:30-40` (constante SQL nova ao lado de `COUNTS_IN_SCORE_SQL`)
- Modify: `server.ts` rota `POST /api/eval/instances/:id/parecer` (~linha 5561: usar a constante)
- Modify: `server.ts` rota `GET /api/eval/dashboard/auditor` (~linha 6608: coluna `pending_count`)
- Modify: `src/lib/auditorDashboard.ts` (`DashboardInstance` ganha `pending_count?`, `display_status?`; `buildAuditorDashboard` preenche `display_status`)
- Test: `src/lib/auditorDashboard.test.ts`

**Interfaces:**
- Consumes: `displayStatus` (Task 1).
- Produces: cada item de `payload.instances` do `/eval/dashboard/auditor` tem `display_status: string`.
- Produces: constante `PENDING_ANSWER_SQL` em server.ts — predicado sobre resposta aliasada `ea`: `ea.evidence_status NOT IN ('aprovado','reprovado','nao_se_aplica')`.

- [ ] **Step 1: Write the failing test** — fim de `src/lib/auditorDashboard.test.ts`:

```ts
test('buildAuditorDashboard anexa display_status (pending_count + pesquisa)', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 1, status: 'em_analise', pending_count: 3, submitted_at: '2026-09-09T12:00:00Z', has_survey_response: false }),
    inst({ id: 2, status: 'em_analise', pending_count: 0, submitted_at: '2026-09-09T12:00:00Z', has_survey_response: false }),
    inst({ id: 3, status: 'em_analise', pending_count: 0, submitted_at: '2026-09-09T12:00:00Z', has_survey_response: true }),
    inst({ id: 4, status: 'pendente' }),
  ], [], now);
  const ds = Object.fromEntries(r.instances.map(i => [i.id, i.display_status]));
  assert.equal(ds[1], 'em_analise');
  assert.equal(ds[2], 'aguardando_pesquisa');
  assert.equal(ds[3], 'emitir_parecer');
  assert.equal(ds[4], 'pendente');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/auditorDashboard.test.ts`
Expected: FAIL — `ds[2]` é `undefined` (display_status não existe) e/ou erro de tipo em `pending_count`.

- [ ] **Step 3: Implement the lib** — em `src/lib/auditorDashboard.ts`, na interface `DashboardInstance`, após `survey_state?`:

```ts
  // Critérios sem decisão terminal (mesmo predicado do parecer) e status mostrado (spec 2026-09-25).
  pending_count?: number;
  display_status?: string;
```

Em `buildAuditorDashboard`, no objeto de `enriched`, após `survey_state: ...`:

```ts
      display_status: displayStatus(i.status, Number(i.pending_count) || 0, i.submitted_at, i.has_survey_response, now),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/auditorDashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the server** — em `server.ts`, logo após a definição de `COUNTS_IN_SCORE_SQL`:

```ts
// Critério ainda sem decisão terminal (resposta aliasada `ea`). Fonte única do
// parecer (trava "critérios sem decisão") e do pending_count do painel — os dois
// precisam bater para "Emitir Parecer Final" ⇔ parecer permitido (spec 2026-09-25).
// Obs.: NOT IN não conta evidence_status NULL (comportamento do parecer, mantido).
const PENDING_ANSWER_SQL = "ea.evidence_status NOT IN ('aprovado','reprovado','nao_se_aplica')";
```

Na rota do parecer, troque:

```ts
      const { rows: pending } = await query(`
        SELECT id FROM eval_answers
         WHERE instance_id = $1 AND evidence_status NOT IN ('aprovado','reprovado','nao_se_aplica')
      `, [id]);
```

por:

```ts
      const { rows: pending } = await query(`
        SELECT ea.id FROM eval_answers ea
         WHERE ea.instance_id = $1 AND ${PENDING_ANSWER_SQL}
      `, [id]);
```

Na query de instâncias do `GET /api/eval/dashboard/auditor`, logo após a linha `(esr.id IS NOT NULL) AS has_survey_response,` acrescente:

```sql
               (SELECT count(*)::int FROM eval_answers ea
                 WHERE ea.instance_id = ei.id AND ${PENDING_ANSWER_SQL}) AS pending_count,
```

- [ ] **Step 6: Type-check + tests**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npx tsc --noEmit -p . 2>&1 | grep -E "server.ts|auditorDashboard" ; node --import tsx --test src/lib/auditorDashboard.test.ts`
Expected: nenhuma linha do tsc para esses arquivos; testes PASS.

- [ ] **Step 7: Commit**

```bash
git add server.ts src/lib/auditorDashboard.ts src/lib/auditorDashboard.test.ts
git commit -m "feat(painel): pending_count e display_status no dashboard do auditor" -m "PENDING_ANSWER_SQL passa a ser a fonte única do parecer e do painel." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Painel do Ciclo — tela

**Files:**
- Modify: `src/pages/qualificacao/PainelDoCiclo.tsx` (`statusPill` ~36, `filtered` ~91, `statusesPresent` ~104, filtro ~234, pill ~275, etiqueta da pesquisa ~280)

**Interfaces:**
- Consumes: `i.display_status` (Task 2); `statusLabel` já importado.

- [ ] **Step 1: Cores** — em `statusPill`, dentro do `map`, após `aguardando_evidencia`:

```ts
    aguardando_pesquisa: 'bg-sky-100 text-sky-800',
    emitir_parecer: 'bg-violet-600 text-white',
```

- [ ] **Step 2: Filtro e opções pelo status mostrado** — em `filtered`, troque
`if (statusFilter && i.status !== statusFilter) return false;`
por
`if (statusFilter && (i.display_status ?? i.status) !== statusFilter) return false;`

Em `statusesPresent`, troque `data.instances.map((i: any) => i.status)` por `data.instances.map((i: any) => i.display_status ?? i.status)`.

No `<option>` do filtro, troque a contagem
`data.instances.filter((i: any) => i.status === st).length`
por
`data.instances.filter((i: any) => (i.display_status ?? i.status) === st).length`

- [ ] **Step 3: Pill e etiqueta** — no pill da coluna Status troque `statusPill(i.status)` e `statusLabel(i.status)` por `statusPill(i.display_status ?? i.status)` e `statusLabel(i.display_status ?? i.status)`.

Troque a condição da etiqueta `{i.survey_state === 'aguardando' && (` por:

```tsx
                    {i.survey_state === 'aguardando' && (i.display_status ?? i.status) !== 'aguardando_pesquisa' && (
```

(`actionTone`/botões de ação continuam usando `i.status` — não mexer.)

- [ ] **Step 4: Type-check + build**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npx tsc --noEmit -p . 2>&1 | grep PainelDoCiclo ; npm run build 2>&1 | tail -1`
Expected: nenhuma linha do tsc; `✓ built in ...`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/qualificacao/PainelDoCiclo.tsx
git commit -m "feat(painel): coluna e filtro de status usam display_status" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prestador — dados e selo

**Files:**
- Modify: `server.ts` rota `GET /api/eval/instances` (~linha 3534, `baseQuery`)
- Modify: `src/pages/qualificacao/PrestadorView.tsx` (import ~12; selo ~415)

**Interfaces:**
- Consumes: `displayStatus` (Task 1), `PENDING_ANSWER_SQL` (Task 2).
- Produces: cada instância de `/api/eval/instances` ganha `pending_count: number` e `has_survey_response: boolean` (`submitted_at` já vem via `ei.*`).

- [ ] **Step 1: Server** — em `baseQuery`, após a subquery `... AS answered_count`, acrescente (atenção à vírgula depois de `answered_count`):

```sql
          ,(SELECT count(*)::int FROM eval_answers ea
             WHERE ea.instance_id = ei.id AND ${PENDING_ANSWER_SQL}) AS pending_count,
          EXISTS (SELECT 1 FROM eval_survey_responses sr WHERE sr.instance_id = ei.id) AS has_survey_response
```

- [ ] **Step 2: Tela** — em `PrestadorView.tsx`, adicione o import:

```ts
import { displayStatus } from '../../lib/auditorDashboard';
```

e no selo (hoje `{statusLabel(inst.status)}`) troque por:

```tsx
                  {statusLabel(displayStatus(inst.status, Number(inst.pending_count) || 0, inst.submitted_at, inst.has_survey_response, new Date(), 'prestador'))}
```

- [ ] **Step 3: Type-check + testes + build**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npx tsc --noEmit -p . 2>&1 | grep -E "server.ts|PrestadorView" ; node --import tsx --test src/lib/*.test.ts 2>&1 | grep -E "^ℹ (pass|fail)" ; npm run build 2>&1 | tail -1`
Expected: sem linhas do tsc; `ℹ fail 0`; `✓ built in ...`.

- [ ] **Step 4: Sanidade no banco do dev (só leitura)** — confirme que a subquery roda e que `pending_count` bate com a trava do parecer:

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx -e "
import('dotenv/config').then(async()=>{const pg=(await import('pg')).default;const c=new pg.Client({connectionString:process.env.DATABASE_URL_DEV,ssl:{rejectUnauthorized:false}});await c.connect();await c.query('SET default_transaction_read_only = on');
console.table((await c.query(\"SELECT ei.id, ei.status, (SELECT count(*)::int FROM eval_answers ea WHERE ea.instance_id=ei.id AND ea.evidence_status NOT IN ('aprovado','reprovado','nao_se_aplica')) AS pending_count, EXISTS(SELECT 1 FROM eval_survey_responses sr WHERE sr.instance_id=ei.id) AS has_survey FROM eval_instances ei WHERE ei.status IN ('em_analise','aguardando_evidencia') LIMIT 10\")).rows);await c.end();})"
```

Expected: tabela com as instâncias em análise (no dev hoje: 1 linha), sem erro.

- [ ] **Step 5: Commit**

```bash
git add server.ts src/pages/qualificacao/PrestadorView.tsx
git commit -m "feat(prestador): selo mostra Aguardando Pesquisa (displayStatus modo prestador)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Verificação final (após as 4 tasks)

- `npm test` (suíte do package.json) — esperado: tudo verde exceto nada novo quebrado.
- `npm run build` — ok.
- QA manual (precisa login humano, dev): um roteiro em análise com todos os critérios decididos e pesquisa não respondida aparece como **Aguardando Pesquisa** no painel e no prestador; após responder a pesquisa, o painel mostra **Emitir Parecer Final** e o prestador **Em Análise**; o filtro "Emitir Parecer Final" lista só esses.
