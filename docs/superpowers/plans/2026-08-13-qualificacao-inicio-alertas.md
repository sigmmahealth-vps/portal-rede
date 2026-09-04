# Qualificação — Aba "Início" como Mural de Alertas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a aba **Início** do portal do prestador (módulo Qualificação) num mural que mostra **apenas** o que exige ação do prestador, agrupado por tipo e ordenado por urgência, parando de duplicar a lista de roteiros.

**Architecture:** A lógica de derivação (quais status viram alerta, contagem, ordenação) vira um módulo **puro** e testável (`src/lib/inicioAlerts.ts`), consumido pela `PrestadorView.tsx` que só renderiza. Dois campos novos vêm do backend para o modelo funcionar: `plan.pending` (o roteiro/plano ainda depende do prestador) e `cert.seen` (certificado já aberto). O certificado novo (#6) usa uma coluna nova `eval_certificates.first_viewed_at` + endpoint para marcar "visto".

**Tech Stack:** React 19 + TypeScript, Tailwind, lucide-react, Express + `pg`, migrations SQL versionadas (`db:migrate`), testes com `node --import tsx --test`.

## Global Constraints

- **Node fora do PATH nesta máquina.** Use o node do nvm. Descubra o caminho e prefixe os comandos (ver `[[node-nao-esta-no-path]]`). Todos os comandos `npm ...` deste plano assumem esse prefixo. Exemplo de descoberta:
  ```bash
  ls "$HOME/AppData/Roaming/nvm" 2>/dev/null; ls "$LOCALAPPDATA/nvm" 2>/dev/null
  ```
- **Sem framework de teste novo.** Testes são `*.test.ts` puros rodados por `node --import tsx --test` e registrados no script `test` do `package.json`. Nada de React Testing Library / fixtures de DB.
- **Migrations:** arquivo novo em `db/migrations/`, ordem lexicográfica. A última existente é `0027_pesquisa_satisfacao.sql`; a nova é **`0028_`**. Aplicar com `npm run db:migrate` **somente em dev** (`APP_ENV`/host de dev — nunca produção; ver `[[portal-ambientes-bancos]]`).
- **Fonte da verdade dos status** (não inventar): estados editáveis do prestador = `pendente`, `em_andamento`, `aguardando_evidencia`. `em_analise` e terminais (`finalizado`/`aprovado`/`reprovado`/`ciclo_encerrado`) **não** geram alerta.
- **Contagem N** (`Você tem N atividades pendentes`) = soma dos itens dos grupos `corrigir + plano + continuar + iniciar + pesquisa`. Certificado novo **não** conta.
- **Ordem dos grupos** (fixa): `corrigir` → `plano` → `continuar` → `iniciar` → `pesquisa`. Certificado novo é bloco à parte.

---

## File Structure

- `src/lib/inicioAlerts.ts` — **novo.** Modelo puro do mural: recebe `{ instances, surveys, plans, certificates }`, devolve `{ pendingCount, groups, newCertificates }`. Coração da feature; onde os critérios de aceite viram código testável.
- `src/lib/inicioAlerts.test.ts` — **novo.** Testes unitários do módulo acima (node --test).
- `package.json` — **modificar.** Registrar o teste novo no script `test`.
- `server.ts` — **modificar.** (a) `/api/me/action-plans` retorna `pending`; (b) `loadCertificates` retorna `seen`; (c) endpoint novo `POST /api/me/certificates/:id/seen`.
- `db/migrations/0028_certificate_seen.sql` — **novo.** Coluna `first_viewed_at` + backfill dos certificados existentes como "já vistos".
- `src/pages/qualificacao/PrestadorView.tsx` — **modificar.** Carregar planos+certificados; substituir o bloco `inicioTab` pelo mural; ajustar o lembrete de pesquisa entre abas.

---

## Task 1: Módulo puro `inicioAlerts.ts` (o mural, sem React)

**Files:**
- Create: `src/lib/inicioAlerts.ts`
- Test: `src/lib/inicioAlerts.test.ts`
- Modify: `package.json:21` (script `test`)

**Interfaces:**
- Consumes: dados crus dos endpoints (formatos já existentes):
  - instância: `{ id, status, script_id, script_title, location_label, location_uf, location_id, total_questions, answered_count }`
  - survey (`/me/survey` → `surveys[]`): `{ instance_id, state, expired, deadline, script_title, location_label, location_uf }`
  - plano (`/me/action-plans`): `{ id, cycle_label, location_label, location_uf, pending }` (`pending` vem da Task 2)
  - certificado (`/me/certificates`): `{ id, seal, location_label, seen }` (`seen` vem da Task 3)
- Produces (consumido pela Task 4):
  ```ts
  type AlertType = 'corrigir' | 'plano' | 'continuar' | 'iniciar' | 'pesquisa';
  const ALERT_ORDER: AlertType[];
  interface AlertItem { key:string; ref:string; detail?:string;
    instanceId?:number; scriptId?:number; locationId?:number|null; planId?:number; deadline?:string; }
  interface AlertGroup { type:AlertType; count:number; items:AlertItem[]; }
  interface NewCert { id:number; seal:string; locationLabel:string|null; }
  interface InicioModel { pendingCount:number; groups:AlertGroup[]; newCertificates:NewCert[]; }
  function buildInicioModel(input:{ instances?:any[]; surveys?:any[]; plans?:any[]; certificates?:any[] }): InicioModel;
  ```

- [ ] **Step 1: Escrever o teste falhando**

Create `src/lib/inicioAlerts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInicioModel } from './inicioAlerts.ts';

const inst = (o: any) => ({
  id: 1, status: 'pendente', script_id: 9, script_title: 'RN 630',
  location_label: 'Rua X', location_uf: 'sc', location_id: 5,
  total_questions: 47, answered_count: 0, ...o,
});

test('aguardando_evidencia vira grupo corrigir', () => {
  const m = buildInicioModel({ instances: [inst({ id: 1, status: 'aguardando_evidencia' })] });
  assert.equal(m.groups[0].type, 'corrigir');
  assert.equal(m.groups[0].count, 1);
  assert.equal(m.groups[0].items[0].ref, 'RN 630 — Rua X/SC');
});

test('pendente sem respostas vira iniciar; em_andamento parcial vira continuar com "faltam X de N"', () => {
  const m = buildInicioModel({ instances: [
    inst({ id: 1, status: 'pendente', answered_count: 0 }),
    inst({ id: 2, status: 'em_andamento', answered_count: 35, total_questions: 47 }),
  ] });
  const iniciar = m.groups.find(g => g.type === 'iniciar')!;
  const continuar = m.groups.find(g => g.type === 'continuar')!;
  assert.equal(iniciar.count, 1);
  assert.equal(continuar.count, 1);
  assert.equal(continuar.items[0].detail, 'faltam 12 de 47');
});

test('em_analise, terminais e ciclo_encerrado não geram alerta', () => {
  const m = buildInicioModel({ instances: [
    inst({ id: 1, status: 'em_analise' }),
    inst({ id: 2, status: 'finalizado' }),
    inst({ id: 3, status: 'aprovado' }),
    inst({ id: 4, status: 'ciclo_encerrado' }),
  ] });
  assert.equal(m.groups.length, 0);
  assert.equal(m.pendingCount, 0);
});

test('survey disponível no prazo vira pesquisa; expirada/respondida não', () => {
  const m = buildInicioModel({ surveys: [
    { instance_id: 1, state: 'disponivel', expired: false, deadline: '2026-09-01', location_label: 'Rua X', location_uf: 'sc' },
    { instance_id: 2, state: 'disponivel', expired: true },
    { instance_id: 3, state: 'respondida' },
  ] });
  const g = m.groups.find(x => x.type === 'pesquisa')!;
  assert.equal(g.count, 1);
  assert.equal(g.items[0].ref, 'Rua X/SC');
});

test('plano pending gera alerta; não-pending é ignorado', () => {
  const m = buildInicioModel({ plans: [
    { id: 10, cycle_label: 'Ciclo 2026', location_label: 'Rua X', location_uf: 'sc', pending: true },
    { id: 11, cycle_label: 'Ciclo 2025', pending: false },
  ] });
  const g = m.groups.find(x => x.type === 'plano')!;
  assert.equal(g.count, 1);
  assert.equal(g.items[0].planId, 10);
});

test('certificado não visto entra em newCertificates e NÃO conta em pendingCount', () => {
  const m = buildInicioModel({
    instances: [inst({ id: 1, status: 'pendente' })],
    certificates: [{ id: 3, seal: 'Ouro', location_label: 'Rua X', seen: false },
                   { id: 4, seal: 'Prata', location_label: 'Rua Y', seen: true }],
  });
  assert.equal(m.newCertificates.length, 1);
  assert.equal(m.newCertificates[0].id, 3);
  assert.equal(m.pendingCount, 1); // só a instância iniciar; cert não conta
});

test('pendingCount = soma de corrigir+plano+continuar+iniciar+pesquisa', () => {
  const m = buildInicioModel({
    instances: [
      inst({ id: 1, status: 'aguardando_evidencia' }),                 // corrigir
      inst({ id: 2, status: 'pendente', answered_count: 0 }),          // iniciar
      inst({ id: 3, status: 'em_andamento', answered_count: 10 }),     // continuar
    ],
    plans: [{ id: 10, cycle_label: 'C', pending: true }],              // plano
    surveys: [{ instance_id: 9, state: 'disponivel', expired: false, deadline: '2026-09-01', location_label: 'Z' }], // pesquisa
  });
  assert.equal(m.pendingCount, 5);
});

test('grupos vêm na ordem corrigir, plano, continuar, iniciar, pesquisa', () => {
  const m = buildInicioModel({
    instances: [
      inst({ id: 1, status: 'pendente', answered_count: 0 }),
      inst({ id: 2, status: 'em_andamento', answered_count: 10 }),
      inst({ id: 3, status: 'aguardando_evidencia' }),
    ],
    plans: [{ id: 10, cycle_label: 'C', pending: true }],
    surveys: [{ instance_id: 9, state: 'disponivel', expired: false, deadline: '2026-09-01', location_label: 'Z' }],
  });
  assert.deepEqual(m.groups.map(g => g.type), ['corrigir', 'plano', 'continuar', 'iniciar', 'pesquisa']);
});

test('vazio: sem pendências e sem certificado', () => {
  const m = buildInicioModel({});
  assert.equal(m.pendingCount, 0);
  assert.deepEqual(m.groups, []);
  assert.deepEqual(m.newCertificates, []);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run (com o prefixo de node do `[[node-nao-esta-no-path]]`):
```bash
node --import tsx --test src/lib/inicioAlerts.test.ts
```
Expected: FAIL — `Cannot find module './inicioAlerts.ts'` (arquivo ainda não existe).

- [ ] **Step 3: Implementar o módulo**

Create `src/lib/inicioAlerts.ts`:

```ts
// src/lib/inicioAlerts.ts
// Modelo puro do "mural de alertas" da aba Início (spec 2026-08-13).
// Sem I/O nem React: recebe os dados dos endpoints e devolve os grupos
// ordenados por urgência + a contagem de pendências. Testável com node --test.

export type AlertType = 'corrigir' | 'plano' | 'continuar' | 'iniciar' | 'pesquisa';

// Ordem de exibição por urgência (spec §3). Todos os 5 tipos contam em N.
export const ALERT_ORDER: AlertType[] = ['corrigir', 'plano', 'continuar', 'iniciar', 'pesquisa'];

// Estados em que o prestador ainda edita a instância (espelha PrestadorView).
const EDITABLE_STATES = ['pendente', 'em_andamento', 'aguardando_evidencia'];

export interface AlertItem {
  key: string;
  ref: string;
  detail?: string;
  instanceId?: number;
  scriptId?: number;
  locationId?: number | null;
  planId?: number;
  deadline?: string;
}
export interface AlertGroup { type: AlertType; count: number; items: AlertItem[]; }
export interface NewCert { id: number; seal: string; locationLabel: string | null; }
export interface InicioModel { pendingCount: number; groups: AlertGroup[]; newCertificates: NewCert[]; }

function locStr(label?: string | null, uf?: string | null): string {
  if (!label) return '';
  return uf ? `${label}/${String(uf).toUpperCase()}` : label;
}
function withLoc(title: string, label?: string | null, uf?: string | null): string {
  const l = locStr(label, uf);
  return l ? `${title} — ${l}` : title;
}
function fillPct(total: number, answered: number): number {
  return total > 0 ? Math.round((answered / total) * 100) : 0;
}

export function buildInicioModel(input: {
  instances?: any[]; surveys?: any[]; plans?: any[]; certificates?: any[];
}): InicioModel {
  const buckets: Record<AlertType, AlertItem[]> = {
    corrigir: [], plano: [], continuar: [], iniciar: [], pesquisa: [],
  };

  for (const i of input.instances ?? []) {
    const base: AlertItem = {
      key: `inst-${i.id}`,
      ref: withLoc(i.script_title, i.location_label, i.location_uf),
      instanceId: Number(i.id),
      scriptId: Number(i.script_id),
      locationId: i.location_id ?? null,
    };
    if (i.status === 'aguardando_evidencia') {
      buckets.corrigir.push(base);
    } else if (EDITABLE_STATES.includes(i.status)) {
      const total = Number(i.total_questions) || 0;
      const answered = Number(i.answered_count) || 0;
      if (fillPct(total, answered) === 0) buckets.iniciar.push(base);
      else buckets.continuar.push({ ...base, detail: `faltam ${total - answered} de ${total}` });
    }
    // em_analise, terminais e ciclo_encerrado não geram alerta (spec §Máquina de estados).
  }

  for (const p of input.plans ?? []) {
    if (!p.pending) continue;
    buckets.plano.push({
      key: `plan-${p.id}`,
      planId: Number(p.id),
      ref: withLoc(p.cycle_label || `Plano #${p.id}`, p.location_label, p.location_uf),
    });
  }

  for (const s of input.surveys ?? []) {
    if (s.state === 'disponivel' && !s.expired) {
      buckets.pesquisa.push({
        key: `survey-${s.instance_id}`,
        instanceId: Number(s.instance_id),
        ref: locStr(s.location_label, s.location_uf) || s.script_title || 'Unidade',
        deadline: s.deadline,
      });
    }
  }

  const groups: AlertGroup[] = ALERT_ORDER
    .map(type => ({ type, count: buckets[type].length, items: buckets[type] }))
    .filter(g => g.count > 0);

  const pendingCount = groups.reduce((n, g) => n + g.count, 0);

  const newCertificates: NewCert[] = (input.certificates ?? [])
    .filter(c => !c.seen)
    .map(c => ({ id: Number(c.id), seal: c.seal, locationLabel: c.location_label ?? null }));

  return { pendingCount, groups, newCertificates };
}
```

- [ ] **Step 4: Registrar o teste no `package.json`**

Em `package.json`, no fim da lista do script `test` (após `src/lib/scoreMemory.test.ts`), acrescentar ` src/lib/inicioAlerts.test.ts`:

```json
    "test": "node --import tsx --test db/roteiro-parser.test.ts auth/otp.test.ts auth/trustedDevice.test.ts auth/rateLimit.test.ts auth/mailer.test.ts auth/setupToken.test.ts auth/passwordPolicy.test.ts auth/auditLog.test.ts auth/ipHash.test.ts db/purgeExpiredLogs.test.ts db/providers-parser.test.ts db/resolveDbUrl.test.ts src/lib/score.test.ts db/roteiro-rule.test.ts db/tabela-parser.test.ts db/import-tabela.test.ts src/lib/auditorDashboard.test.ts src/lib/auditorXlsx.test.ts src/lib/computeSeal.test.ts src/lib/dimensionAgg.test.ts src/lib/actionPlan.test.ts src/lib/certValidity.test.ts src/lib/providerEdit.test.ts src/lib/scoreMemory.test.ts src/lib/inicioAlerts.test.ts"
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run:
```bash
node --import tsx --test src/lib/inicioAlerts.test.ts
```
Expected: PASS — 9 testes ok.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inicioAlerts.ts src/lib/inicioAlerts.test.ts package.json
git commit -m "feat(qualificacao): modelo puro do mural de alertas da aba Inicio"
```

---

## Task 2: `/api/me/action-plans` retorna `pending`

**Files:**
- Modify: `server.ts:4921-4937` (handler `GET /api/me/action-plans`)

**Interfaces:**
- Produces: cada item da lista ganha `pending: boolean` = existe item do plano em status que ainda depende do prestador (`nao_iniciada`, `em_andamento`, `solicitada_revisao`, `reprovada`) e o plano não está encerrado sem conclusão. Consumido por `buildInicioModel` (Task 1) e pela Task 4.

Racional: o conjunto de status "pendente do prestador" é o mesmo `OPEN_ITEM` de `src/lib/actionPlan.ts:20` (`nao_iniciada`/`em_andamento`/`solicitada_revisao`/`reprovada`). Itens em `aguardando_revisao` aguardam o auditor (não são ação do prestador) e por isso **não** ligam o alerta.

- [ ] **Step 1: Ampliar a query da lista para computar `pending`**

Em `server.ts`, substituir o SELECT do handler `GET /api/me/action-plans` (linhas 4925-4934) por:

```ts
      const { rows } = await query(`
        SELECT p.id, p.cycle_id, c.label AS cycle_label, p.created_at, p.closed_without_completion,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS location_cidade, pl.uf AS location_uf,
               (NOT p.closed_without_completion AND EXISTS (
                  SELECT 1 FROM eval_action_items ai
                   WHERE ai.plan_id = p.id
                     AND ai.status IN ('nao_iniciada','em_andamento','solicitada_revisao','reprovada')
               )) AS pending
          FROM eval_action_plans p
          LEFT JOIN eval_cycles c ON c.id = p.cycle_id
          LEFT JOIN provider_locations pl ON pl.id = p.location_id
         WHERE p.provider_id = $1
         ORDER BY p.created_at DESC
      `, [providerId]);
```

- [ ] **Step 2: Verificar tipos (não há teste de integração de DB neste repo)**

Run:
```bash
npm run lint
```
Expected: PASS — `tsc --noEmit` sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat(qualificacao): expor pending por plano em /me/action-plans"
```

---

## Task 3: Certificado novo — flag `seen` + marcar "visto"

**Files:**
- Create: `db/migrations/0028_certificate_seen.sql`
- Modify: `server.ts` — `loadCertificates` (linhas 4941-5018) e área dos endpoints de certificado (após `GET /api/me/certificates`, ~linha 5027)

**Interfaces:**
- Produces:
  - `loadCertificates` inclui `seen: boolean` em cada certificado (`first_viewed_at != null`).
  - `POST /api/me/certificates/:id/seen` — marca o certificado do próprio prestador como visto (idempotente). Consumido pela Task 4.

- [ ] **Step 1: Migration da coluna + backfill**

Create `db/migrations/0028_certificate_seen.sql`:

```sql
-- 0028_certificate_seen.sql
-- Certificado "novo" no mural da aba Início (spec 2026-08-13, estado #6).
-- first_viewed_at NULL = ainda não aberto pelo prestador (gera alerta positivo).
-- Preenchido na 1ª abertura; a partir daí o certificado some do mural.

ALTER TABLE eval_certificates ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz;

-- Backfill: certificados que já existem NÃO devem inundar o mural como "novos".
-- Marca todos os atuais como já vistos (visto = data de emissão).
UPDATE eval_certificates SET first_viewed_at = issued_at WHERE first_viewed_at IS NULL;
```

- [ ] **Step 2: Aplicar a migration (apenas em DEV)**

Confirme que está no banco de **dev** (`[[portal-ambientes-bancos]]`), então:
```bash
npm run db:migrate
```
Expected: `+ aplicada:   0028_certificate_seen.sql`.

- [ ] **Step 3: `loadCertificates` passa a devolver `seen`**

Em `server.ts`, no SELECT de `loadCertificates` (linha 4943), acrescentar `ec.first_viewed_at` à lista de colunas:

```ts
        SELECT ec.id, ec.verify_code, ec.issued_at, ec.valid_until, ec.first_viewed_at,
               ei.id AS instance_id, ei.provider_id, ei.seal, ei.percentual,
```

E no objeto retornado (dentro do `certs.map`, junto de `valid_until`, ~linha 5006), adicionar:

```ts
          valid_until: r.valid_until,
          seen: r.first_viewed_at != null,
```

- [ ] **Step 4: Endpoint para marcar "visto"**

Em `server.ts`, logo após o handler `GET /api/me/certificates` (que termina na linha 5027), inserir:

```ts
  // Marca o certificado como aberto pela 1ª vez (spec 2026-08-13, estado #6):
  // some do mural de Início e continua acessível em Certificados. Idempotente.
  app.post('/api/me/certificates/:id/seen', authenticate, async (req: any, res) => {
    try {
      const providerId = req.user.provider_id;
      if (!providerId) return res.status(403).json({ error: 'Unauthorized' });
      const { rowCount } = await query(`
        UPDATE eval_certificates ec
           SET first_viewed_at = now()
          FROM eval_instances ei
         WHERE ec.id = $1
           AND ei.id = ec.instance_id
           AND ei.provider_id = $2
           AND ec.first_viewed_at IS NULL
      `, [Number(req.params.id), providerId]);
      res.json({ ok: true, updated: rowCount });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });
```

- [ ] **Step 5: Verificar tipos**

Run:
```bash
npm run lint
```
Expected: PASS — sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0028_certificate_seen.sql server.ts
git commit -m "feat(qualificacao): flag seen e endpoint de visto do certificado"
```

---

## Task 4: `PrestadorView` — renderizar o mural na aba Início

**Files:**
- Modify: `src/pages/qualificacao/PrestadorView.tsx`

**Interfaces:**
- Consumes: `buildInicioModel`, `ALERT_ORDER`, tipos `AlertType`/`AlertGroup`/`AlertItem`/`InicioModel` de `../../lib/inicioAlerts` (Task 1); campos `plan.pending` (Task 2) e `cert.seen` (Task 3).

- [ ] **Step 1: Carregar planos e certificados + importar o modelo**

No topo de `PrestadorView.tsx`, ajustar imports:
- Trocar a linha de ícones (linha 4-6) para incluir os ícones dos grupos:
  ```ts
  import {
    Play, Clock, LayoutGrid, ClipboardList, Target, Award, Smile, ArrowRight, MapPin,
    AlertTriangle, ChevronDown, ChevronRight, CheckCircle2,
  } from 'lucide-react';
  ```
  (Removidos `Eye` — não é mais usado no Início; `Eye` continua? Verifique: `actionFor`/roteirosTab ainda usam `Eye` na linha 126. **Mantenha `Eye`** na lista de imports.)
- Remover o import agora sem uso: `import { welcomeLine } from '../../lib/greeting';` (linha 3) — o "Bom dia" sai do Início (spec: bloco de saudação duplicava).
- Adicionar:
  ```ts
  import { buildInicioModel, type AlertType, type AlertItem } from '../../lib/inicioAlerts';
  ```

Adicionar estado e carga. Depois de `const [survey, setSurvey] = useState<any>(null);` (linha 55), adicionar:
```ts
  const [plans, setPlans] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
```
Dentro de `loadData`, ampliar o `Promise.all` (linhas 68-72) e os setters:
```ts
      const [scriptsData, instancesData, providerData, plansData, certsData] = await Promise.all([
        fetchApi('/eval/scripts'),
        fetchApi('/eval/instances'),
        fetchApi('/me/provider').catch(() => null),
        fetchApi('/me/action-plans').catch(() => []),
        fetchApi('/me/certificates').catch(() => []),
      ]);
      setScripts(scriptsData);
      setInstances(instancesData);
      setEvalScriptId(providerData?.eval_script_id ?? null);
      setLocations(providerData?.locations ?? []);
      setPlans(plansData ?? []);
      setCertificates(certsData ?? []);
```

- [ ] **Step 2: Marcar certificado como visto (handler)**

Dentro do componente, perto de `loadSurvey` (linha 56), adicionar:
```ts
  const openNewCertificate = async (id: number) => {
    try { await fetchApi(`/me/certificates/${id}/seen`, { method: 'POST' }); } catch { /* segue mesmo assim */ }
    await loadData();
    setActiveTab('certificados');
  };
```

- [ ] **Step 3: Substituir o bloco `inicioTab`**

Trocar todo o `const inicioTab = (...);` (linhas 140-221) por:

```tsx
  // --- Mural de alertas (spec 2026-08-13) ------------------------------------
  const model = buildInicioModel({ instances, surveys: survey?.surveys ?? [], plans, certificates });

  const GROUP_META: Record<AlertType, { label: string; Icon: any; dot: string; card: string; btn: string }> = {
    corrigir:  { label: 'Corrigir e reenviar',      Icon: AlertTriangle, dot: 'bg-red-500',     card: 'border-red-200 bg-red-50/60',       btn: 'bg-red-500 hover:bg-red-600' },
    plano:     { label: 'Responder plano de ação',  Icon: Target,        dot: 'bg-orange-500',  card: 'border-orange-200 bg-orange-50/60', btn: 'bg-orange-500 hover:bg-orange-600' },
    continuar: { label: 'Continuar avaliação',      Icon: Clock,         dot: 'bg-amber-500',   card: 'border-amber-200 bg-amber-50/60',   btn: 'bg-amber-500 hover:bg-amber-600' },
    iniciar:   { label: 'Iniciar avaliação',        Icon: Play,          dot: 'bg-blue-500',    card: 'border-blue-200 bg-blue-50/60',     btn: 'bg-blue-500 hover:bg-blue-600' },
    pesquisa:  { label: 'Responder pesquisa (+10)', Icon: Smile,         dot: 'bg-emerald-500', card: 'border-emerald-200 bg-emerald-50/60', btn: 'bg-emerald-500 hover:bg-emerald-600' },
  };

  // Ação de cada item, por tipo de grupo.
  const runItem = (type: AlertType, it: AlertItem) => {
    if (type === 'pesquisa') { setActiveTab('pesquisa'); return; }
    if (type === 'plano') { setActiveTab('planos'); return; }
    // corrigir / continuar / iniciar → abre o player do roteiro.
    setActivePlayer({ scriptId: it.scriptId!, instanceId: it.instanceId, locationId: it.locationId ?? undefined, readOnly: false });
  };
  const itemBtnLabel = (type: AlertType): string =>
    type === 'corrigir' ? 'Corrigir' : type === 'plano' ? 'Responder' : type === 'pesquisa' ? 'Responder' : type === 'continuar' ? 'Continuar' : 'Iniciar';

  const AlertGroupCard = ({ type, items }: { type: AlertType; items: AlertItem[] }) => {
    const meta = GROUP_META[type];
    // Grupo com 1 item já vem expandido, sem colapso (spec §2).
    const [open, setOpen] = useState(items.length === 1);
    const single = items.length === 1;
    return (
      <div className={`rounded-2xl border ${meta.card}`}>
        <button
          type="button"
          onClick={() => !single && setOpen(v => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${meta.dot}`}>
            <meta.Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-bold text-secondary-900">{meta.label}</span>
            <span className="ml-2 text-sm font-medium text-gray-500">{items.length} roteiro{items.length > 1 ? 's' : ''}</span>
          </span>
          {!single && (open ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />)}
        </button>
        {open && (
          <ul className="space-y-2 px-4 pb-4">
            {items.map(it => (
              <li key={it.key} className="flex flex-col gap-2 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-secondary-900">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" /> {it.ref}
                  </p>
                  {it.detail && <p className="mt-0.5 text-xs font-medium text-gray-500">{it.detail}</p>}
                  {it.deadline && <p className="mt-0.5 text-xs font-medium text-gray-500">até {new Date(it.deadline).toLocaleDateString('pt-BR')}</p>}
                </div>
                <button
                  onClick={() => runItem(type, it)}
                  className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors ${meta.btn}`}
                >
                  {itemBtnLabel(type)} <ArrowRight className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const inicioTab = (
    <div className="space-y-6">
      {/* Linha de resumo */}
      {model.pendingCount > 0 ? (
        <p className="text-lg font-bold text-secondary-900">
          Você tem {model.pendingCount} atividade{model.pendingCount > 1 ? 's' : ''} pendente{model.pendingCount > 1 ? 's' : ''}.
        </p>
      ) : model.newCertificates.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="flex items-center gap-2 text-lg font-bold text-secondary-900">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" /> Tudo em dia
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Nada precisa da sua atenção agora.{' '}
            <button onClick={() => setActiveTab('roteiros')} className="font-semibold text-emerald-700 hover:underline">
              Ver Meus Roteiros
            </button>
          </p>
        </div>
      )}

      {/* Grupos de alerta, na ordem de urgência do modelo */}
      {model.groups.map(g => <AlertGroupCard key={g.type} type={g.type} items={g.items} />)}

      {/* Bloco positivo: certificado novo (não conta em N; some após 1ª abertura) */}
      {model.newCertificates.map(c => (
        <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Award className="h-7 w-7 text-amber-500" />
            <div>
              <p className="font-bold text-amber-900">Novo certificado disponível</p>
              <p className="text-sm text-amber-800">Selo {c.seal}{c.locationLabel ? ` — ${c.locationLabel}` : ''}</p>
            </div>
          </div>
          <button
            onClick={() => openNewCertificate(c.id)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-600"
          >
            Ver certificado <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
```

> Observação: o bloco estático "Sobre a qualificação" foi removido do Início junto com o card antigo — o mural fica só com o que exige ação. Se quiser mantê-lo, reinsira-o abaixo do mural (é explicativo, não duplica lista). // ponytail: removido por padrão (mural = só ação); reinserir se o cliente pedir contexto.

- [ ] **Step 4: Não duplicar o lembrete de pesquisa na própria aba Início**

O banner de pesquisa (linhas 353-377) aparece em todas as abas menos `pesquisa`. Como o grupo #8 já cobre isso dentro do mural, esconda-o também na aba `inicio`. Trocar a condição da linha 353:

```tsx
      {pendingSurveys.length > 0 && !['pesquisa', 'inicio'].includes(activeTab) && (
```

- [ ] **Step 5: Verificar tipos**

Run:
```bash
npm run lint
```
Expected: PASS — sem erros novos. (Se `Eye` ou `statusLabel` ficarem sem uso, ajuste os imports até `tsc` passar.)

- [ ] **Step 6: Verificar no preview (dev)**

Suba o dev server e confira a aba Início com um usuário-teste que tenha pendências (ver usuários de teste em `[[portal-qualificacao-modulo-543]]`):
- `Você tem N atividades pendentes` bate com a soma dos grupos.
- Grupos na ordem corrigir → plano → continuar → iniciar → pesquisa; cada um com contagem, expansível; grupo de 1 item já expandido.
- Nenhum roteiro `em_analise`/terminal/`ciclo_encerrado` aparece; nenhum "100% respondido / Visualizar".
- Estado vazio aparece quando não há pendências nem certificado novo.
- Certificado novo aparece como bloco à parte; ao clicar "Ver certificado", ele some do Início e passa a viver só em Certificados (recarregue a aba Início para confirmar que não volta).

- [ ] **Step 7: Commit**

```bash
git add src/pages/qualificacao/PrestadorView.tsx
git commit -m "feat(qualificacao): aba Inicio como mural de alertas agrupados"
```

---

## Self-Review

**1. Cobertura da spec (critérios de aceite):**
1. Início não exibe status informativo (#3/#6-lista/#7) — Task 1 filtra `em_analise`/terminais/`ciclo_encerrado`; testado. ✅
2. Enviados não aparecem como "100% respondido / Visualizar" — bloco antigo removido na Task 4; `em_analise` fora do modelo. ✅
3. `N` = #1+#2+#4+#5+#8, certificado não conta — Task 1, `pendingCount` = soma dos grupos; teste dedicado. ✅
4. Agrupados com contagem e expansíveis — Task 1 (grupos) + Task 4 (`AlertGroupCard`). ✅
5. Ordenados por urgência — `ALERT_ORDER`; teste dedicado. ✅
6. Estado vazio — Task 4 (bloco "Tudo em dia"). ✅
7. Certificado novo separado e some após 1ª abertura — Tasks 3 + 4 (`seen`/`openNewCertificate`). ✅

**2. Placeholders:** nenhum "TBD/TODO/etc." — todos os steps têm código/SQL/comando reais.

**3. Consistência de tipos:** `buildInicioModel`, `AlertType`, `AlertItem`, `ALERT_ORDER`, campos `pending`/`seen` — mesmos nomes em Tasks 1→4. `runItem`/`GROUP_META` cobrem todos os 5 `AlertType`.

**Decisões (ponytail):**
- `pending` do plano usa o mesmo conjunto `OPEN_ITEM` de `actionPlan.ts` (itens que dependem do prestador); `aguardando_revisao` não liga alerta.
- `seen` do certificado é durável no banco (não localStorage) — cross-device e alinhado ao rigor LGPD do app; backfill marca os certificados atuais como já vistos para não inundar o mural.
- Botão de plano/pesquisa só troca de aba (não pré-seleciona item) — Planos/Pesquisa já auto-selecionam. Add pré-seleção só se o cliente pedir.

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-08-13-qualificacao-inicio-alertas.md`. Duas opções de execução:

**1. Subagent-Driven (recomendado)** — despacho um subagente por task, reviso entre tasks, iteração rápida.

**2. Inline Execution** — executo as tasks nesta sessão (executing-plans), com checkpoints de review.

Qual abordagem?
