# Plano de Ação 5W2H — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo Plano de Ação (5W2H) do ciclo de qualificação — geração automática/semiautomática/manual a partir do parecer, acompanhamento trimestral com evidências, Kanban do auditor e do prestador, persistência entre ciclos (spec 5.4.4.1–5.4.4.8).

**Architecture:** 3 tabelas novas (`eval_action_plans`, `eval_action_items`, `eval_action_events`) penduradas em `eval_instances`/`eval_cycles`; geração enganchada no `POST /parecer`; status exibidos ("A Vencer", "Atrasado", cores) são **derivados em leitura** por funções puras em `src/lib/actionPlan.ts` (testáveis sem banco); evidências reusam a tabela `documents` (`type='plano_acao_evidencia'`); Kanban sem drag-and-drop (cartões mudam de coluna por botões de ação).

**Tech Stack:** Express + SQL cru parametrizado (`query`/`withTransaction` de `db/db.ts`), multer existente, React + Tailwind v4 + lucide-react, `node --test` + tsx.

**Decisões travadas (validadas com o mapeamento do código):**
1. Tabela legada `action_plans` e rotas `/api/action-plans` ficam intocadas (só demo-seed usa). Módulo novo usa prefixo `/api/eval/action-plans`.
2. Status persistidos do item: `nao_iniciada | em_andamento | aguardando_revisao | solicitada_revisao | reprovada | concluida`. Status do PLANO não é persistido — é derivado dos itens + prazos (`computePlanStatus`), exceto o flag `closed_without_completion` gravado no encerramento do ciclo. "A Vencer"/"Atrasado" nunca são gravados (evita job diário).
3. Janelas trimestrais: derivadas da data de criação do plano — J1 = +90d, J2 = +180d, J3 = +270d (`computeWindows`). Prazo sugerido de item = início + 90d (spec 5.4.4.2). **[PENDENTE confirmação do usuário — ver "Questões abertas"]**
4. "Não Pontuado" = answer com `is_non_compliant = true` OU `evidence_status = 'reprovado'` no momento do parecer.
5. Obrigatórios (sem omissão): candidatos com `dimension = 'Documento Legal'` reprovados; e, se % Segurança (com DL colapsado) < 60, todos os candidatos de Segurança. Demais candidatos são selecionáveis pelo auditor no parecer (semiautomática) — default: todos marcados.
6. Recorrência entre ciclos: match por `eval_questions.code` (estável entre versões de roteiro) + `provider_id`.
7. Limiar "A Vencer": constante `DUE_SOON_DAYS = 15` em `src/lib/actionPlan.ts`. Sem tela de config.

**Questões abertas (não bloqueiam Tasks 0–2; confirmar antes da Task 3):**
- Âncora das janelas trimestrais (criação do plano vs. datas fixas do ciclo). Default: criação do plano.
- Campo "Onde" (Where) do 5W2H foi omitido da spec — assumido intencional.

---

### Task 0: Fix bug N/A no parecer (pré-requisito do gatilho Segurança<60%)

**Files:**
- Modify: `server.ts:4300-4302` (SQL do parecer)

O front grava `answer_value='na'` (minúsculo, `RoteiroPlayer.tsx`), mas o parecer filtra `<> 'NA'` (maiúsculo) — N/A não sai do denominador hoje. O dashboard (`server.ts:4374`) já usa `LOWER(...)`.

- [ ] **Step 1: Corrigir o filtro**

Em `server.ts`, no SQL de `totals` do endpoint `POST /api/eval/instances/:id/parecer`, trocar as duas ocorrências:

```sql
-- antes
FILTER (WHERE ea.answer_value <> 'NA')
-- depois
FILTER (WHERE LOWER(COALESCE(ea.answer_value,'')) <> 'na')
```

- [ ] **Step 2: Verificar tipagem/build**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "fix(qualif): parecer exclui respostas 'na' do denominador (case-insensitive)"
```

---

### Task 1: Migration 0024 — tabelas do plano de ação

**Files:**
- Create: `db/migrations/0024_plano_acao_5w2h.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0024_plano_acao_5w2h.sql
-- Plano de Ação 5W2H (spec 5.4.4). Um plano por instância de avaliação;
-- planos manuais avulsos têm instance_id NULL.

CREATE TABLE eval_action_plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cycle_id bigint REFERENCES eval_cycles(id),
  instance_id bigint REFERENCES eval_instances(id) ON DELETE SET NULL,
  provider_id bigint NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  location_id bigint REFERENCES provider_locations(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('automatica','semiautomatica','manual')),
  closed_without_completion boolean NOT NULL DEFAULT false,
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX eval_action_plans_instance_uniq
  ON eval_action_plans (instance_id) WHERE instance_id IS NOT NULL;
CREATE INDEX eval_action_plans_cycle_idx ON eval_action_plans (cycle_id);
CREATE INDEX eval_action_plans_provider_idx ON eval_action_plans (provider_id);

CREATE TABLE eval_action_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id bigint NOT NULL REFERENCES eval_action_plans(id) ON DELETE CASCADE,
  answer_id bigint REFERENCES eval_answers(id) ON DELETE SET NULL,
  question_code text,          -- denormalizado p/ recorrência entre ciclos
  question_text text,
  dimension text,
  is_mandatory boolean NOT NULL DEFAULT false,  -- DL reprovado / Segurança<60%
  what text NOT NULL,
  why text,
  who_name text,
  who_role text,
  start_date date,
  due_date date,               -- sugerido: start_date + 90d
  how text,
  how_much text,               -- horas, R$ ou 'N/A' (livre)
  status text NOT NULL DEFAULT 'nao_iniciada'
    CHECK (status IN ('nao_iniciada','em_andamento','aguardando_revisao',
                      'solicitada_revisao','reprovada','concluida')),
  completed_at timestamptz,    -- quando o prestador marcou concluída
  validated_by bigint REFERENCES users(id),
  validated_at timestamptz,    -- quando o auditor validou
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eval_action_items_plan_idx ON eval_action_items (plan_id);
CREATE INDEX eval_action_items_qcode_idx ON eval_action_items (question_code);

CREATE TABLE eval_action_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES eval_action_items(id) ON DELETE CASCADE,
  actor_id bigint REFERENCES users(id),
  actor_name text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('prestador','auditor')),
  action text NOT NULL CHECK (action IN
    ('criou','editou','iniciou','comentou','anexou_evidencia',
     'marcou_concluida','concluiu','solicitou_revisao','reprovou')),
  comment text,
  document_id bigint REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eval_action_events_item_idx ON eval_action_events (item_id);
```

- [ ] **Step 2: Aplicar em dev**

Run: `npm run db:migrate`
Expected: `applied 0024_plano_acao_5w2h.sql` (usa o banco do `APP_ENV` atual — conferir que aponta para dev).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0024_plano_acao_5w2h.sql
git commit -m "feat(plano-acao): migration 0024 - eval_action_plans/items/events"
```

---

### Task 2: Lib pura `src/lib/actionPlan.ts` + testes

**Files:**
- Create: `src/lib/actionPlan.ts`
- Create: `src/lib/actionPlan.test.ts`
- Modify: `package.json` (lista do script `test` já cobre `src/lib/*.test.ts` — conferir; se cobre, nada a fazer)

- [ ] **Step 1: Escrever os testes (RED)**

```ts
// src/lib/actionPlan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWindows, computePlanStatus, planColor, buildAutoItems,
  DUE_SOON_DAYS,
} from './actionPlan.js';

const D = (s: string) => new Date(s + 'T12:00:00Z');

test('computeWindows: 3 janelas a +90/+180/+270 dias da criação', () => {
  const w = computeWindows(D('2026-10-15'));
  assert.equal(w.length, 3);
  assert.equal(w[0].toISOString().slice(0, 10), '2027-01-13');
  assert.equal(w[1].toISOString().slice(0, 10), '2027-04-13');
  assert.equal(w[2].toISOString().slice(0, 10), '2027-07-12');
});

test('computePlanStatus: plano sem interação e sem itens ativos = aberto', () => {
  const s = computePlanStatus({
    items: [{ status: 'nao_iniciada', due_date: '2027-06-01' }],
    hasProviderInteraction: false,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'aberto');
});

test('computePlanStatus: item aguardando_revisao domina', () => {
  const s = computePlanStatus({
    items: [
      { status: 'concluida', due_date: '2027-01-01' },
      { status: 'aguardando_revisao', due_date: '2027-06-01' },
    ],
    hasProviderInteraction: true,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'aguardando_revisao');
});

test('computePlanStatus: prazo expirado com item aberto = atrasado', () => {
  const s = computePlanStatus({
    items: [{ status: 'em_andamento', due_date: '2026-10-01' }],
    hasProviderInteraction: true,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'atrasado');
});

test(`computePlanStatus: a menos de ${DUE_SOON_DAYS} dias do prazo = a_vencer`, () => {
  const s = computePlanStatus({
    items: [{ status: 'em_andamento', due_date: '2026-11-10' }],
    hasProviderInteraction: true,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'a_vencer');
});

test('computePlanStatus: todas concluídas = concluido; encerrado domina tudo', () => {
  const base = {
    items: [{ status: 'concluida', due_date: '2026-10-01' }],
    hasProviderInteraction: true, now: D('2026-11-01'),
  };
  assert.equal(computePlanStatus({ ...base, closedWithoutCompletion: false }), 'concluido');
  assert.equal(computePlanStatus({ ...base, closedWithoutCompletion: true }), 'encerrado_sem_conclusao');
});

test('planColor: mapeamento 5.4.4.5', () => {
  assert.equal(planColor('em_andamento'), 'verde');
  assert.equal(planColor('aberto'), 'azul');
  assert.equal(planColor('aguardando_revisao'), 'azul');
  assert.equal(planColor('a_vencer'), 'laranja');
  assert.equal(planColor('atrasado'), 'vermelho');
});

test('buildAutoItems: reprovados viram itens; DL é obrigatório', () => {
  const answers = [
    { id: 1, question_code: 'DL-01', question_text: 'Alvará sanitário vigente',
      legislation: 'RDC 63/2011', dimension: 'Documento Legal',
      is_non_compliant: true, evidence_status: 'reprovado', guidance: 'Anexar alvará' },
    { id: 2, question_code: 'S-04', question_text: 'Rotas de fuga sinalizadas',
      legislation: 'RDC 50/2002', dimension: 'Segurança',
      is_non_compliant: true, evidence_status: 'reprovado', guidance: null },
    { id: 3, question_code: 'C-02', question_text: 'Sala de espera climatizada',
      legislation: null, dimension: 'Conforto',
      is_non_compliant: false, evidence_status: 'aprovado', guidance: null },
  ];
  const items = buildAutoItems(answers, { segurancaPct: 72 });
  assert.equal(items.length, 2); // só os não conformes
  const dl = items.find(i => i.question_code === 'DL-01')!;
  assert.equal(dl.is_mandatory, true);
  assert.match(dl.why, /RDC 63\/2011/);
  const seg = items.find(i => i.question_code === 'S-04')!;
  assert.equal(seg.is_mandatory, false); // Segurança >= 60%
});

test('buildAutoItems: Segurança < 60% torna itens de Segurança obrigatórios', () => {
  const answers = [
    { id: 2, question_code: 'S-04', question_text: 'Rotas de fuga sinalizadas',
      legislation: 'RDC 50/2002', dimension: 'Segurança',
      is_non_compliant: true, evidence_status: 'reprovado', guidance: null },
  ];
  const items = buildAutoItems(answers, { segurancaPct: 45 });
  assert.equal(items[0].is_mandatory, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/actionPlan.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/lib/actionPlan.ts`**

```ts
// src/lib/actionPlan.ts
// Lógica pura do Plano de Ação 5W2H (spec 5.4.4). Sem I/O — testável sem banco.

export const DUE_SOON_DAYS = 15;
export const ITEM_DEFAULT_TERM_DAYS = 90;

const DAY_MS = 86_400_000;

/** 3 janelas trimestrais a partir da criação do plano (+90/+180/+270 dias). */
export function computeWindows(planCreatedAt: Date): Date[] {
  return [1, 2, 3].map(n => new Date(planCreatedAt.getTime() + n * ITEM_DEFAULT_TERM_DAYS * DAY_MS));
}

export type ItemLike = { status: string; due_date: string | null };

export type PlanStatus =
  | 'aberto' | 'em_andamento' | 'aguardando_revisao'
  | 'a_vencer' | 'atrasado' | 'concluido' | 'encerrado_sem_conclusao';

const OPEN_ITEM = new Set(['nao_iniciada', 'em_andamento', 'solicitada_revisao', 'reprovada']);

export function computePlanStatus(args: {
  items: ItemLike[];
  hasProviderInteraction: boolean;
  closedWithoutCompletion: boolean;
  now: Date;
}): PlanStatus {
  const { items, hasProviderInteraction, closedWithoutCompletion, now } = args;
  if (closedWithoutCompletion) return 'encerrado_sem_conclusao';
  if (items.length > 0 && items.every(i => i.status === 'concluida')) return 'concluido';

  const open = items.filter(i => i.status !== 'concluida');
  const dueDates = open
    .filter(i => OPEN_ITEM.has(i.status) && i.due_date)
    .map(i => new Date(i.due_date + 'T23:59:59Z').getTime());

  if (dueDates.length) {
    const nearest = Math.min(...dueDates);
    if (nearest < now.getTime()) return 'atrasado';
    if (nearest - now.getTime() <= DUE_SOON_DAYS * DAY_MS) return 'a_vencer';
  }
  if (open.some(i => i.status === 'aguardando_revisao')) return 'aguardando_revisao';
  if (hasProviderInteraction || open.some(i => i.status !== 'nao_iniciada')) return 'em_andamento';
  return 'aberto';
}

/** Cores do painel do auditor (spec 5.4.4.5). */
export function planColor(status: PlanStatus): 'verde' | 'azul' | 'laranja' | 'vermelho' | 'cinza' {
  switch (status) {
    case 'em_andamento': return 'verde';
    case 'aberto':
    case 'aguardando_revisao': return 'azul';
    case 'a_vencer': return 'laranja';
    case 'atrasado': return 'vermelho';
    default: return 'cinza'; // concluido / encerrado_sem_conclusao
  }
}

export type AnswerForPlan = {
  id: number; question_code: string | null; question_text: string;
  legislation: string | null; dimension: string | null;
  is_non_compliant: boolean; evidence_status: string | null; guidance: string | null;
};

export type AutoItem = {
  answer_id: number; question_code: string | null; question_text: string;
  dimension: string | null; is_mandatory: boolean;
  what: string; why: string; how: string | null;
};

/** Gera os itens candidatos do plano a partir das respostas do parecer (5.4.4.1). */
export function buildAutoItems(
  answers: AnswerForPlan[],
  ctx: { segurancaPct: number },
): AutoItem[] {
  const nonCompliant = answers.filter(
    a => a.is_non_compliant || a.evidence_status === 'reprovado',
  );
  const segMandatory = ctx.segurancaPct < 60;
  return nonCompliant.map(a => {
    const isDL = a.dimension === 'Documento Legal';
    const isSeg = a.dimension === 'Segurança';
    return {
      answer_id: a.id,
      question_code: a.question_code,
      question_text: a.question_text,
      dimension: a.dimension,
      is_mandatory: isDL || (isSeg && segMandatory),
      what: `Adequar o critério: ${a.question_text}`,
      why: a.legislation
        ? `Critério não atendido na avaliação. Embasamento: ${a.legislation}`
        : 'Critério não atendido na avaliação do ciclo de qualificação.',
      how: a.guidance,
    };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test src/lib/actionPlan.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Conferir que `package.json` `test` já engloba `src/lib/*.test.ts` (engloba — nada a mudar). Rodar suíte completa**

Run: `npm test`
Expected: PASS geral.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actionPlan.ts src/lib/actionPlan.test.ts
git commit -m "feat(plano-acao): lib pura - janelas, status derivado, cores, buildAutoItems"
```

---

### Task 3: Geração no parecer (automática + semiautomática)

**Files:**
- Modify: `server.ts` — endpoint `POST /api/eval/instances/:id/parecer` (~linha 4277) e novo endpoint de preview

- [ ] **Step 1: Endpoint de preview dos candidatos (para o modal do parecer)**

Adicionar logo antes do endpoint de parecer:

```ts
// Candidatos a plano de ação (não conformes) da instância — usado no modal do parecer
app.get('/api/eval/instances/:id/plano-candidatos', authenticate, async (req: any, res) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const id = Number(req.params.id);
    const { rows } = await query(`
      SELECT ea.id, eq.code AS question_code, eq.text AS question_text,
             eq.legislation, eq.dimension, eq.guidance,
             ea.is_non_compliant, ea.evidence_status
        FROM eval_answers ea
        JOIN eval_questions eq ON eq.id = ea.question_id
       WHERE ea.instance_id = $1
         AND (ea.is_non_compliant OR ea.evidence_status = 'reprovado')
       ORDER BY eq.dimension, eq.code
    `, [id]);

    const { rows: [seg] } = await query(`
      SELECT COALESCE(SUM(ea.score_obtained) FILTER (WHERE LOWER(COALESCE(ea.answer_value,'')) <> 'na'), 0)::numeric AS score,
             COALESCE(SUM(eq.max_score)      FILTER (WHERE LOWER(COALESCE(ea.answer_value,'')) <> 'na'), 0)::numeric AS max
        FROM eval_answers ea
        JOIN eval_questions eq ON eq.id = ea.question_id
       WHERE ea.instance_id = $1 AND eq.dimension IN ('Segurança','Documento Legal')
    `, [id]);
    const segurancaPct = Number(seg.max) > 0 ? Math.round(Number(seg.score) / Number(seg.max) * 10000) / 100 : 100;

    const { buildAutoItems } = await import('./src/lib/actionPlan.js');
    res.json({ seguranca_pct: segurancaPct, items: buildAutoItems(rows as any, { segurancaPct }) });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Gerar o plano dentro do parecer**

No `POST /api/eval/instances/:id/parecer`, o body passa a aceitar `{ plan_answer_ids?: number[] }` (semiautomática; ausente = automática pura, entra tudo). Após o `UPDATE eval_instances ... status='aprovado'` e antes do `auditLog`, inserir:

```ts
// ---- Geração do Plano de Ação 5W2H (spec 5.4.4.1) ----
const { rows: candRows } = await query(`
  SELECT ea.id, eq.code AS question_code, eq.text AS question_text,
         eq.legislation, eq.dimension, eq.guidance,
         ea.is_non_compliant, ea.evidence_status
    FROM eval_answers ea
    JOIN eval_questions eq ON eq.id = ea.question_id
   WHERE ea.instance_id = $1
     AND (ea.is_non_compliant OR ea.evidence_status = 'reprovado')
`, [id]);

let planId: number | null = null;
if (candRows.length) {
  const { rows: [segT] } = await query(`
    SELECT COALESCE(SUM(ea.score_obtained) FILTER (WHERE LOWER(COALESCE(ea.answer_value,'')) <> 'na'), 0)::numeric AS score,
           COALESCE(SUM(eq.max_score)      FILTER (WHERE LOWER(COALESCE(ea.answer_value,'')) <> 'na'), 0)::numeric AS max
      FROM eval_answers ea
      JOIN eval_questions eq ON eq.id = ea.question_id
     WHERE ea.instance_id = $1 AND eq.dimension IN ('Segurança','Documento Legal')
  `, [id]);
  const segurancaPct = Number(segT.max) > 0
    ? Math.round(Number(segT.score) / Number(segT.max) * 10000) / 100 : 100;

  const { buildAutoItems, ITEM_DEFAULT_TERM_DAYS } = await import('./src/lib/actionPlan.js');
  const auto = buildAutoItems(candRows as any, { segurancaPct });

  const selected = Array.isArray(req.body?.plan_answer_ids)
    ? new Set(req.body.plan_answer_ids.map(Number)) : null;
  // obrigatórios entram SEMPRE (spec: "sem possibilidade de omissão")
  const chosen = auto.filter(i => i.is_mandatory || !selected || selected.has(i.answer_id));

  if (chosen.length) {
    const origin = selected ? 'semiautomatica' : 'automatica';
    await withTransaction(async (client) => {
      const { rows: [plan] } = await client.query(`
        INSERT INTO eval_action_plans (cycle_id, instance_id, provider_id, location_id, origin, created_by)
        SELECT cycle_id, id, provider_id, location_id, $2, $3 FROM eval_instances WHERE id = $1
        ON CONFLICT (instance_id) WHERE instance_id IS NOT NULL DO NOTHING
        RETURNING id
      `, [id, origin, req.user.id]);
      if (!plan) return; // parecer re-executado: plano já existe, não duplica
      planId = Number(plan.id);
      for (const it of chosen) {
        const { rows: [item] } = await client.query(`
          INSERT INTO eval_action_items
            (plan_id, answer_id, question_code, question_text, dimension, is_mandatory,
             what, why, how, start_date, due_date)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CURRENT_DATE,
                  CURRENT_DATE + ($10 || ' days')::interval)
          RETURNING id
        `, [planId, it.answer_id, it.question_code, it.question_text, it.dimension,
            it.is_mandatory, it.what, it.why, it.how, ITEM_DEFAULT_TERM_DAYS]);
        await client.query(`
          INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
          VALUES ($1, $2, $3, 'auditor', 'criou')
        `, [item.id, req.user.id, req.user.name]);
      }
    });
    if (planId) {
      await auditLog({
        query, userId: req.user.id, action: 'action_plan_generated',
        meta: { provider_id: Number(inst.provider_id), instance_id: id, plan_id: planId,
                origin, items: chosen.length, seguranca_pct: segurancaPct },
        ip: hashClientIp(req),
      });
    }
  }
}
```

E incluir `plan_id: planId` no `res.json` final do parecer.

Nota: conferir se `withTransaction` já é importado no topo do `server.ts`; se não, `import { query, withTransaction } from './db/db.js'`.

- [ ] **Step 3: Lint + teste manual rápido**

Run: `npm run lint`
Expected: sem erros.
Smoke (dev): concluir um parecer com critério reprovado → `SELECT * FROM eval_action_plans ORDER BY id DESC LIMIT 1;` mostra o plano; re-executar parecer não duplica.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(plano-acao): geracao automatica/semiautomatica no parecer + preview de candidatos"
```

---

### Task 4: Endpoints staff — board, detalhe, plano manual, edição e validação de itens

**Files:**
- Modify: `server.ts` (bloco novo após as rotas de parecer; seguir padrão `isStaff` + try/catch)

- [ ] **Step 1: Board de planos (Kanban do auditor)**

```ts
// Lista planos do ciclo com agregados p/ o Kanban (spec 5.4.4.5)
app.get('/api/eval/action-plans', authenticate, async (req: any, res) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const cycleId = req.query.cycle_id ? Number(req.query.cycle_id) : null;
    const { rows } = await query(`
      SELECT p.id, p.cycle_id, p.instance_id, p.provider_id, p.location_id,
             p.origin, p.closed_without_completion, p.created_at,
             pr.name AS provider_name, pr.code AS provider_code, pl.city,
             COALESCE(json_agg(json_build_object('status', i.status, 'due_date', i.due_date))
                      FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
             EXISTS (SELECT 1 FROM eval_action_events e
                      JOIN eval_action_items ii ON ii.id = e.item_id
                     WHERE ii.plan_id = p.id AND e.actor_role = 'prestador') AS has_provider_interaction
        FROM eval_action_plans p
        JOIN providers pr ON pr.id = p.provider_id
        LEFT JOIN provider_locations pl ON pl.id = p.location_id
        LEFT JOIN eval_action_items i ON i.plan_id = p.id
       WHERE ($1::bigint IS NULL OR p.cycle_id = $1)
       GROUP BY p.id, pr.name, pr.code, pl.city
       ORDER BY p.created_at DESC
    `, [cycleId]);

    const { computePlanStatus, planColor } = await import('./src/lib/actionPlan.js');
    const now = new Date();
    res.json(rows.map((r: any) => {
      const status = computePlanStatus({
        items: r.items, hasProviderInteraction: r.has_provider_interaction,
        closedWithoutCompletion: r.closed_without_completion, now,
      });
      return { ...r, status, color: planColor(status) };
    }));
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

⚠️ Conferir nomes reais das colunas de `providers` (`code`?) e `provider_locations` (`city`?) no `0001_baseline.sql` antes de rodar; ajustar aliases se necessário.

- [ ] **Step 2: Detalhe do plano (itens + histórico + janelas)**

```ts
app.get('/api/eval/action-plans/:id', authenticate, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    const { rows: [plan] } = await query(`
      SELECT p.*, pr.name AS provider_name, pr.code AS provider_code
        FROM eval_action_plans p JOIN providers pr ON pr.id = p.provider_id
       WHERE p.id = $1
    `, [id]);
    if (!plan) return res.status(404).json({ error: 'not found' });
    // prestador só vê o próprio plano
    if (!isStaff(req.user.role) && Number(plan.provider_id) !== Number(req.user.provider_id)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { rows: items } = await query(`
      SELECT * FROM eval_action_items WHERE plan_id = $1 ORDER BY is_mandatory DESC, id
    `, [id]);
    const { rows: events } = await query(`
      SELECT e.*, d.file_url AS document_url, d.title AS document_title
        FROM eval_action_events e
        LEFT JOIN documents d ON d.id = e.document_id
       WHERE e.item_id = ANY($1::bigint[])
       ORDER BY e.created_at
    `, [items.map((i: any) => i.id)]);

    const { computeWindows, computePlanStatus, planColor } = await import('./src/lib/actionPlan.js');
    const status = computePlanStatus({
      items, hasProviderInteraction: events.some((e: any) => e.actor_role === 'prestador'),
      closedWithoutCompletion: plan.closed_without_completion, now: new Date(),
    });
    res.json({
      ...plan, status, color: planColor(status),
      windows: computeWindows(new Date(plan.created_at)),
      items: items.map((i: any) => ({ ...i, events: events.filter((e: any) => Number(e.item_id) === Number(i.id)) })),
    });
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

⚠️ Conferir coluna de URL em `documents` (`file_url` vs `url`) no baseline.

- [ ] **Step 3: Plano manual + CRUD de itens (staff)**

```ts
// Plano avulso (spec 5.4.4.1 - Manual). Body: { provider_id, location_id?, cycle_id? }
app.post('/api/eval/action-plans', authenticate, async (req: any, res) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const { provider_id, location_id, cycle_id } = req.body || {};
    if (!provider_id) return res.status(400).json({ error: 'provider_id obrigatório' });
    const { rows: [plan] } = await query(`
      INSERT INTO eval_action_plans (cycle_id, provider_id, location_id, origin, created_by)
      VALUES ($1,$2,$3,'manual',$4) RETURNING *
    `, [cycle_id ?? null, provider_id, location_id ?? null, req.user.id]);
    await auditLog({ query, userId: req.user.id, action: 'action_plan_generated',
      meta: { provider_id: Number(provider_id), plan_id: Number(plan.id), origin: 'manual' },
      ip: hashClientIp(req) });
    res.status(201).json(plan);
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});

// Adicionar item 5W2H. Body: what (obrig.), why, who_name, who_role, start_date, due_date, how, how_much
app.post('/api/eval/action-plans/:id/items', authenticate, async (req: any, res) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const planId = Number(req.params.id);
    const b = req.body || {};
    if (!b.what?.trim()) return res.status(400).json({ error: 'Campo "O quê?" é obrigatório' });
    const { rows: [item] } = await query(`
      INSERT INTO eval_action_items
        (plan_id, what, why, who_name, who_role, start_date, due_date, how, how_much)
      VALUES ($1,$2,$3,$4,$5,
              COALESCE($6::date, CURRENT_DATE),
              COALESCE($7::date, COALESCE($6::date, CURRENT_DATE) + interval '90 days'),
              $8,$9)
      RETURNING *
    `, [planId, b.what.trim(), b.why ?? null, b.who_name ?? null, b.who_role ?? null,
        b.start_date ?? null, b.due_date ?? null, b.how ?? null, b.how_much ?? null]);
    await query(`
      INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
      VALUES ($1,$2,$3,'auditor','criou')
    `, [item.id, req.user.id, req.user.name]);
    res.status(201).json(item);
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});

// Editar campos 5W2H (staff; prestador NUNCA edita descrições - spec 5.4.4.6)
app.patch('/api/eval/action-items/:id', authenticate, async (req: any, res) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const id = Number(req.params.id);
    const allowed = ['what','why','who_name','who_role','start_date','due_date','how','how_much'] as const;
    const sets: string[] = []; const vals: any[] = [];
    for (const k of allowed) if (k in (req.body || {})) { vals.push(req.body[k]); sets.push(`${k} = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'nada para atualizar' });
    vals.push(id);
    const { rows: [item] } = await query(
      `UPDATE eval_action_items SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!item) return res.status(404).json({ error: 'not found' });
    await query(`
      INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
      VALUES ($1,$2,$3,'auditor','editou')
    `, [id, req.user.id, req.user.name]);
    res.json(item);
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

Nota de segurança: `sets` é montado só com chaves da whitelist `allowed` — sem SQL injection via nome de campo.

- [ ] **Step 4: Validação do auditor (Concluir | Solicitar revisão | Reprovar — spec 5.4.4.3)**

```ts
// Body: { decisao: 'concluir'|'solicitar_revisao'|'reprovar', observacao? }
// observacao obrigatória para solicitar_revisao e reprovar (mesmo padrão do /reprovar de answers)
app.post('/api/eval/action-items/:id/validar', authenticate, async (req: any, res) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const id = Number(req.params.id);
    const { decisao, observacao } = req.body || {};
    const map: Record<string, { status: string; action: string }> = {
      concluir:          { status: 'concluida',          action: 'concluiu' },
      solicitar_revisao: { status: 'solicitada_revisao', action: 'solicitou_revisao' },
      reprovar:          { status: 'reprovada',          action: 'reprovou' },
    };
    const m = map[decisao];
    if (!m) return res.status(400).json({ error: 'decisao inválida' });
    if (decisao !== 'concluir' && !observacao?.trim()) {
      return res.status(400).json({ error: 'observação obrigatória' });
    }
    const { rows: [item] } = await query(`
      UPDATE eval_action_items
         SET status = $1,
             validated_by = CASE WHEN $1 = 'concluida' THEN $2 ELSE validated_by END,
             validated_at = CASE WHEN $1 = 'concluida' THEN now() ELSE validated_at END
       WHERE id = $3 AND status = 'aguardando_revisao'
       RETURNING *
    `, [m.status, req.user.id, id]);
    if (!item) return res.status(409).json({ error: 'item não está aguardando revisão' });
    await query(`
      INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action, comment)
      VALUES ($1,$2,$3,'auditor',$4,$5)
    `, [id, req.user.id, req.user.name, m.action, observacao ?? null]);
    await auditLog({ query, userId: req.user.id, action: 'action_item_validated',
      meta: { item_id: id, decisao }, ip: hashClientIp(req) });
    res.json(item);
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` — sem erros.

```bash
git add server.ts
git commit -m "feat(plano-acao): endpoints staff - board, detalhe, plano manual, itens, validacao"
```

---

### Task 5: Endpoints do prestador — meu plano, iniciar, responder, evidência

**Files:**
- Modify: `server.ts`

Padrão anti-IDOR: prestador sempre escopado por `req.user.provider_id` (nunca do body).

- [ ] **Step 1: Helper de carga do item com checagem de dono**

```ts
// Carrega item + plano garantindo que pertence ao prestador logado
async function loadItemForProvider(itemId: number, providerId: number) {
  const { rows: [row] } = await query(`
    SELECT i.*, p.provider_id, p.closed_without_completion
      FROM eval_action_items i JOIN eval_action_plans p ON p.id = i.plan_id
     WHERE i.id = $1
  `, [itemId]);
  if (!row || Number(row.provider_id) !== Number(providerId)) return null;
  return row;
}
```

- [ ] **Step 2: Meus planos**

```ts
app.get('/api/me/action-plans', authenticate, async (req: any, res) => {
  try {
    const providerId = req.user.provider_id;
    if (!providerId) return res.status(403).json({ error: 'Unauthorized' });
    const { rows } = await query(`
      SELECT p.id, p.cycle_id, c.label AS cycle_label, p.created_at, p.closed_without_completion
        FROM eval_action_plans p LEFT JOIN eval_cycles c ON c.id = p.cycle_id
       WHERE p.provider_id = $1
       ORDER BY p.created_at DESC
    `, [providerId]);
    res.json(rows);
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

O detalhe reutiliza `GET /api/eval/action-plans/:id` (Task 4 Step 2 já libera o dono).

- [ ] **Step 3: Iniciar ação / responder (comentário + evidência + marcar concluída)**

```ts
// "Iniciar ação" (mockup 5.4.4.6)
app.post('/api/eval/action-items/:id/iniciar', authenticate, async (req: any, res) => {
  try {
    const item = await loadItemForProvider(Number(req.params.id), req.user.provider_id);
    if (!item) return res.status(403).json({ error: 'Unauthorized' });
    if (item.status !== 'nao_iniciada') return res.status(409).json({ error: 'ação já iniciada' });
    if (item.closed_without_completion) return res.status(409).json({ error: 'plano encerrado' });
    await query(`UPDATE eval_action_items SET status = 'em_andamento' WHERE id = $1`, [item.id]);
    await query(`
      INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
      VALUES ($1,$2,$3,'prestador','iniciou')
    `, [item.id, req.user.id, req.user.name]);
    res.json({ ok: true });
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});

// Responder: multipart (campo file opcional) + comment + conclude ('true'/'false')
// Estados válidos: em_andamento | solicitada_revisao | reprovada (re-tentativa) | nao_iniciada (auto-inicia)
app.post('/api/eval/action-items/:id/responder', authenticate, upload.single('file'), async (req: any, res) => {
  try {
    const item = await loadItemForProvider(Number(req.params.id), req.user.provider_id);
    if (!item) return res.status(403).json({ error: 'Unauthorized' });
    if (item.closed_without_completion) return res.status(409).json({ error: 'plano encerrado' });
    if (['aguardando_revisao','concluida'].includes(item.status)) {
      return res.status(409).json({ error: 'ação em revisão ou concluída' });
    }
    const comment = (req.body?.comment || '').trim() || null;
    const conclude = req.body?.conclude === 'true';
    if (!req.file && !comment && !conclude) {
      return res.status(400).json({ error: 'envie evidência, comentário ou marque conclusão' });
    }

    let documentId: number | null = null;
    if (req.file) {
      const { rows: [doc] } = await query(`
        INSERT INTO documents (provider_id, title, type, file_url, reference_id)
        VALUES ($1,$2,'plano_acao_evidencia',$3,$4) RETURNING id
      `, [req.user.provider_id, req.file.originalname, `/uploads/${req.file.filename}`, item.plan_id]);
      documentId = Number(doc.id);
      await query(`
        INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action, comment, document_id)
        VALUES ($1,$2,$3,'prestador','anexou_evidencia',$4,$5)
      `, [item.id, req.user.id, req.user.name, comment, documentId]);
    } else if (comment) {
      await query(`
        INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action, comment)
        VALUES ($1,$2,$3,'prestador','comentou',$4)
      `, [item.id, req.user.id, req.user.name, comment]);
    }

    const newStatus = conclude ? 'aguardando_revisao' : 'em_andamento';
    await query(`
      UPDATE eval_action_items
         SET status = $1, completed_at = CASE WHEN $1 = 'aguardando_revisao' THEN now() ELSE completed_at END
       WHERE id = $2
    `, [newStatus, item.id]);
    if (conclude) {
      await query(`
        INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
        VALUES ($1,$2,$3,'prestador','marcou_concluida')
      `, [item.id, req.user.id, req.user.name]);
    }
    await auditLog({ query, userId: req.user.id, action: 'action_item_responded',
      meta: { item_id: Number(item.id), conclude, has_file: !!req.file }, ip: hashClientIp(req) });
    res.json({ status: newStatus });
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

⚠️ Conferir colunas reais de `documents` no baseline (`title`, `type`, `file_url`, `reference_id`) e ajustar o INSERT se divergirem.

- [ ] **Step 4: Lint + commit**

```bash
git add server.ts
git commit -m "feat(plano-acao): endpoints prestador - meus planos, iniciar, responder com evidencia"
```

---

### Task 6: Encerramento de ciclo + recorrência entre ciclos (spec 5.4.4.7)

**Files:**
- Modify: `server.ts` — `closeCycleCore()` (~linha 4142) + novo endpoint de recorrência

- [ ] **Step 1: Marcar planos no encerramento**

Dentro de `closeCycleCore`, após o UPDATE das instâncias para `ciclo_encerrado`, adicionar:

```ts
// Planos com itens abertos viram 'encerrado sem conclusão' (spec 5.4.4.4/5.4.4.7)
await query(`
  UPDATE eval_action_plans p
     SET closed_without_completion = true
   WHERE p.cycle_id = $1
     AND NOT p.closed_without_completion
     AND EXISTS (SELECT 1 FROM eval_action_items i
                  WHERE i.plan_id = p.id AND i.status <> 'concluida')
`, [cycleId]);
```

- [ ] **Step 2: Endpoint de recorrência (alerta na análise do roteiro)**

```ts
// Critérios recorrentes: question_codes com item de plano de ciclos anteriores do mesmo prestador
app.get('/api/eval/instances/:id/recorrencias', authenticate, async (req: any, res) => {
  try {
    if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const id = Number(req.params.id);
    const { rows } = await query(`
      SELECT DISTINCT i.question_code, i.question_text, i.status,
             c.label AS cycle_label
        FROM eval_instances cur
        JOIN eval_action_plans p ON p.provider_id = cur.provider_id
             AND (p.cycle_id IS DISTINCT FROM cur.cycle_id)
        JOIN eval_action_items i ON i.plan_id = p.id AND i.question_code IS NOT NULL
        LEFT JOIN eval_cycles c ON c.id = p.cycle_id
       WHERE cur.id = $1
    `, [id]);
    res.json(rows);
  } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 3: Lint + commit**

```bash
git add server.ts
git commit -m "feat(plano-acao): encerramento sem conclusao no fechamento de ciclo + endpoint de recorrencias"
```

---

### Task 7: Front staff — aba "Plano de Ação" com Kanban de planos

**Files:**
- Create: `src/pages/qualificacao/PlanosBoard.tsx`
- Create: `src/pages/qualificacao/planoStatus.ts` (rótulos/cores compartilhados front)
- Modify: `src/pages/qualificacao/QualificacaoStaff.tsx` (array `TABS` linhas 9-13 + render)

- [ ] **Step 1: Constantes de status/cor**

```ts
// src/pages/qualificacao/planoStatus.ts
export const PLAN_STATUS_LABEL: Record<string, string> = {
  aberto: 'Em aberto', em_andamento: 'Em andamento',
  aguardando_revisao: 'Aguardando validação', a_vencer: 'A vencer',
  atrasado: 'Atrasado', concluido: 'Concluído',
  encerrado_sem_conclusao: 'Encerrado sem conclusão',
};
export const PLAN_COLOR_CLASS: Record<string, string> = {
  verde: 'bg-emerald-100 text-emerald-800',
  azul: 'bg-blue-100 text-blue-800',
  laranja: 'bg-orange-100 text-orange-800',
  vermelho: 'bg-red-100 text-red-800',
  cinza: 'bg-gray-100 text-gray-600',
};
export const ITEM_STATUS_LABEL: Record<string, string> = {
  nao_iniciada: 'Não iniciada', em_andamento: 'Em andamento',
  aguardando_revisao: 'Aguardando revisão', solicitada_revisao: 'Solicitada revisão',
  reprovada: 'Reprovada', concluida: 'Concluída',
};
```

- [ ] **Step 2: PlanosBoard**

Estrutura (seguir mockup do painel do auditor — colunas fixas, sem drag-and-drop):

```tsx
// src/pages/qualificacao/PlanosBoard.tsx
// Kanban de PLANOS (cards = prestadores). Colunas por status derivado do plano.
// - fetchApi(`/eval/action-plans?cycle_id=${cycleId}`) no mount (cycle_id do ciclo ativo,
//   mesmo padrão de PainelDoCiclo.tsx para buscar o ciclo)
// - Header: contadores (ativos = !concluido/!encerrado; atrasados; aguardando validação),
//   busca por nome/código do prestador (filtro client-side), select de ciclo
// - COLUNAS: [aberto+em_andamento => 'Em aberto'], ['aguardando_revisao' => 'Aguardando validação'],
//   ['a_vencer' => 'A vencer'], ['atrasado' => 'Atrasado'], ['concluido'+'encerrado_sem_conclusao' => 'Finalizados']
// - Card: provider_name, provider_code, city, badge PLAN_COLOR_CLASS[color],
//   contagem de itens abertos, botão "Ver plano" -> abre <PlanoDetail planId=... />
// - Botão "Novo plano avulso" (staff) -> modal: select de prestador
//   (mesma fonte de prestadores usada em Admin.tsx) + POST /api/eval/action-plans
```

Implementar seguindo os padrões visuais de `PainelDoCiclo.tsx` (cards brancos, KPIs no topo) e estado `useState`/`useEffect` + `fetchApi` como o resto do módulo. Sem lib nova.

- [ ] **Step 3: Registrar a aba**

Em `QualificacaoStaff.tsx`, adicionar ao array `TABS`:

```ts
{ id: 'planos', label: 'Plano de Ação' },
```

e no render: `{aba === 'planos' && <PlanosBoard />}`.

- [ ] **Step 4: Build + commit**

Run: `npm run lint && npm run build`
Expected: build ok.

```bash
git add src/pages/qualificacao/PlanosBoard.tsx src/pages/qualificacao/planoStatus.ts src/pages/qualificacao/QualificacaoStaff.tsx
git commit -m "feat(plano-acao): aba Plano de Acao no staff com kanban de planos"
```

---

### Task 8: Front staff — detalhe do plano (Kanban de ações) + validação

**Files:**
- Create: `src/pages/qualificacao/PlanoDetail.tsx`
- Create: `src/pages/qualificacao/ItemHistorico.tsx` (reaproveitar padrão de `IterationTimeline.tsx`)

- [ ] **Step 1: PlanoDetail (modal full-screen, padrão AuditorPlayer)**

```tsx
// src/pages/qualificacao/PlanoDetail.tsx
// Kanban de AÇÕES do plano (spec 5.4.4.8). Colunas fixas:
//   'Em aberto'          <- status: nao_iniciada | em_andamento | aguardando_revisao
//   'Solicitada Revisão' <- solicitada_revisao
//   'Reprovado'          <- reprovada
//   'Concluído'          <- concluida
// - fetchApi(`/eval/action-plans/${planId}`) -> { items[], windows[], status, ... }
// - Header: prestador, origem do plano, badge de status, timeline das 3 janelas
//   (windows[] do backend; marcar cada janela como Concluída/Em X dias/Aguardando
//    comparando com now — mesmo visual do mockup do prestador)
// - Card de ação: what, question_code, dimension, badge is_mandatory ("Obrigatório"),
//   who_name/who_role, due_date, botões:
//     - "Editar" (staff): modal com campos 5W2H -> PATCH /eval/action-items/:id
//     - se status = aguardando_revisao: "Validar" -> modal com radio
//       Concluir | Solicitar revisão | Reprovar + textarea observação
//       -> POST /eval/action-items/:id/validar
//     - "Histórico" -> <ItemHistorico events={item.events} />
// - Botão "Adicionar ação" -> modal 5W2H -> POST /eval/action-plans/:id/items
//   (campo Quando: input date início + prazo auto-preenchido com +90d, editável — spec 5.4.4.2)
```

- [ ] **Step 2: ItemHistorico**

Lista cronológica dos events: `"{actor_name} — {actor_role === 'auditor' ? 'Auditor' : 'Prestador'} — {AÇÃO} em {data}"`, com link para `document_url` quando houver anexo. Copiar o layout de `IterationTimeline.tsx`.

- [ ] **Step 3: Build + commit**

```bash
git add src/pages/qualificacao/PlanoDetail.tsx src/pages/qualificacao/ItemHistorico.tsx
git commit -m "feat(plano-acao): detalhe do plano com kanban de acoes, edicao 5W2H e validacao"
```

---

### Task 9: Front staff — seleção semiautomática no parecer (AuditorPlayer)

**Files:**
- Modify: `src/pages/qualificacao/AuditorPlayer.tsx` (fluxo do parecer, ~linha 345)

- [ ] **Step 1: Trocar o `window.confirm` do parecer por um modal de duas etapas**

Ao clicar "Emitir parecer":
1. `fetchApi('/eval/instances/' + id + '/plano-candidatos')` → lista de candidatos + `seguranca_pct`.
2. Se lista vazia → confirma parecer direto (comportamento atual, `POST /parecer` sem body extra).
3. Se houver candidatos → modal "Plano de Ação será gerado" com checkbox por critério:
   - `is_mandatory` → checkbox marcado e **desabilitado**, badge "Obrigatório" (DL reprovado / Segurança < 60% — spec: sem possibilidade de omissão);
   - demais → marcados por default, desmarcáveis (semiautomática).
   - Banner quando `seguranca_pct < 60`: "Quesito Segurança abaixo de 60% — plano obrigatório".
4. Confirmar → `POST /parecer` com `{ plan_answer_ids: [ids marcados] }`.
5. Alert de sucesso mostra selo + "Plano de ação gerado com N ações" quando `plan_id` retornado.

- [ ] **Step 2: Build + commit**

```bash
git add src/pages/qualificacao/AuditorPlayer.tsx
git commit -m "feat(plano-acao): selecao semiautomatica de criterios no parecer final"
```

---

### Task 10: Front prestador — "Meu Plano de Ação" (spec 5.4.4.6)

**Files:**
- Create: `src/pages/qualificacao/MeuPlanoAcao.tsx`
- Modify: `src/pages/qualificacao/PrestadorView.tsx` (linhas 10-16: tirar `soon: true` da aba `planos`; linha ~340: trocar `<EmBreve/>` por `<MeuPlanoAcao/>`)

- [ ] **Step 1: MeuPlanoAcao (seguir o mockup aprovado)**

```tsx
// src/pages/qualificacao/MeuPlanoAcao.tsx
// - fetchApi('/me/action-plans') -> pega o mais recente (ou select se houver vários)
// - fetchApi(`/eval/action-plans/${id}`) -> detalhe
// - Header: "Meu Plano de Ação — {cycle_label}", badge status,
//   "X de Y ações concluídas", timeline das 3 janelas (windows[])
// - Lista vertical de cards de ação (NÃO é kanban na visão do prestador — mockup):
//   * status 'concluida': card verde-claro com O QUÊ/POR QUÊ/RESPONSÁVEL +
//     painel "STATUS DE ENTREGA: Concluído em {completed_at}" +
//     "Validado em {validated_at}" + evidência enviada (link do último event anexou_evidencia)
//   * status 'em_andamento' | 'solicitada_revisao' | 'reprovada': card com
//     O QUÊ/POR QUÊ/COMO EVIDENCIAR/PRAZO LIMITE (due_date + janela) +
//     painel "Enviar atualização ou evidência": <input type="file"> (padrão
//     RoteiroPlayer.tsx:324-369, FormData) + textarea comentário +
//     botões "Marcar como concluída" (conclude=true) e "Enviar evidência parcial"
//     -> POST /eval/action-items/:id/responder
//     * se 'solicitada_revisao'/'reprovada': banner laranja/vermelho com a
//       observação do auditor (último event solicitou_revisao/reprovou)
//   * status 'aguardando_revisao': card bloqueado "Evidências em análise..."
//     + botão "Ver o que foi enviado" (abre histórico)
//   * status 'nao_iniciada': card cinza com what + prazo + botão "Iniciar ação"
//     -> POST /eval/action-items/:id/iniciar
//   * todos: link "Ver histórico" -> <ItemHistorico events={item.events}/>
// - Campos do auditor SEMPRE somente leitura (spec: prestador não altera descrições)
// - Plano closed_without_completion: banner "Encerrado sem conclusão" e interações bloqueadas
// - Sem plano: estado vazio "Nenhum plano de ação para o seu estabelecimento"
```

- [ ] **Step 2: Ligar a aba**

Em `PrestadorView.tsx`: remover `soon: true` de `planos`; no render da aba, `<MeuPlanoAcao />` no lugar do `<EmBreve .../>`.

- [ ] **Step 3: Build + commit**

```bash
git add src/pages/qualificacao/MeuPlanoAcao.tsx src/pages/qualificacao/PrestadorView.tsx
git commit -m "feat(plano-acao): visao do prestador - meu plano de acao com evidencias e historico"
```

---

### Task 11: Alerta de recorrência na análise (spec 5.4.4.7)

**Files:**
- Modify: `src/pages/qualificacao/AuditorPlayer.tsx`

- [ ] **Step 1: Buscar recorrências no mount**

`fetchApi('/eval/instances/' + id + '/recorrencias')` → mapa `question_code -> {cycle_label, status}`. Nos cards de critério cujo `code` estiver no mapa, badge âmbar "Recorrente — não conforme no {cycle_label}" (tooltip com status do item anterior: encerrado sem conclusão etc.).

- [ ] **Step 2: Build + commit**

```bash
git add src/pages/qualificacao/AuditorPlayer.tsx
git commit -m "feat(plano-acao): alerta de criterio recorrente na analise do roteiro"
```

---

### Task 12: Verificação final

- [ ] **Step 1: Suíte completa + build**

Run: `npm test && npm run lint && npm run build`
Expected: tudo verde.

- [ ] **Step 2: Smoke manual em dev (checklist)**

1. Abrir ciclo de teste, responder roteiro com 2 critérios "NÃO" (1 DL, 1 Segurança), submeter.
2. Auditor reprova os 2, emite parecer → modal mostra os 2 candidatos, DL travado; confirmar.
3. Aba Plano de Ação (staff): plano aparece na coluna "Em aberto"; abrir detalhe; editar um item (why/who/prazo).
4. Como prestador: aba Planos de Ação → iniciar ação, anexar arquivo + comentário, marcar concluída.
5. Staff: card foi para "Aguardando validação"; validar com "Solicitar revisão" → prestador vê banner e reenvia; validar com "Concluir".
6. Histórico do item mostra a cronologia completa com atores.
7. Encerrar ciclo com item aberto → plano vira "Encerrado sem conclusão"; abrir novo ciclo + nova análise do mesmo prestador → badge "Recorrente" no critério.

- [ ] **Step 3: Push (deploy dev/homolog via push na main — NUNCA chamar de produção)**

```bash
git push origin main
```

---

## Self-Review (executada na escrita)

- **Cobertura da spec:** 5.4.4.1 (Task 3+4: 3 origens; obrigatoriedade DL/Segurança em `buildAutoItems` + filtro `is_mandatory` no parecer) · 5.4.4.2 (migration com 6 campos 5W2H; +90d no INSERT e no modal) · 5.4.4.3 (janelas em `computeWindows`; validação Concluir/Revisão/Reprovar na Task 4; eventos com ator/data na `eval_action_events`; histórico visível nos dois perfis Tasks 8/10) · 5.4.4.4 (status derivado em `computePlanStatus`; encerrado_sem_conclusao na Task 6) · 5.4.4.5 (cores em `planColor` + board Task 7) · 5.4.4.6 (Task 10, campos read-only, interação restrita) · 5.4.4.7 (Task 6: flag no fechamento + endpoint recorrências + Task 11 badge) · 5.4.4.8 (Task 8: colunas Em aberto/Solicitada Revisão/Reprovado/Concluído).
- **Riscos apontados no código:** nomes de colunas de `providers`/`provider_locations`/`documents` precisam ser conferidos no baseline na execução das Tasks 4/5 (anotado inline).
- **Consistência de tipos:** status de item usados no CHECK da migration = os usados em `computePlanStatus`, endpoints e front (`planoStatus.ts`).
