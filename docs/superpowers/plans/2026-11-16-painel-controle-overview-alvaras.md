# Gestão Documental — Painel de Controle (Overview + Alvarás) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard admin de Gestão Documental (aba Painel de Controle) com Overview e Alvarás, agregando os documentos em cards, gráficos e taxas de conformidade.

**Architecture:** Agregação 100% no cliente a partir de `GET /api/documents` (reusa statusDocumento/providerAudience). Métricas em funções puras testadas; UI em `PainelControle.tsx` com sub-abas e gráficos `recharts`.

**Tech Stack:** TypeScript, React, `recharts`, `node:test`.

Spec: [docs/superpowers/specs/2026-11-16-painel-controle-overview-alvaras-design.md](../specs/2026-11-16-painel-controle-overview-alvaras-design.md)

## Global Constraints

- Imports TypeScript usam sufixo `.js` (lib) / extensionless (componentes).
- Agrega só documentos de gestão documental: `type_id != null`; exclui `historico`.
- Situações: **regular** (aprovado válido), **vencendo** (aprovado, validade ≤ 30 dias), **irregular** (vencido ou reprovado), **pendente** (em análise).
- Conformidade = `(regular + vencendo) / (regular + vencendo + irregular)` em %, 0 quando denominador 0; **pendentes não entram**.
- 4º card é **Pendentes** (não "Verificar"). Taxa é **entre documentos enviados**.
- Alvarás casados por `doc.type`: `'Alvará Sanitário'`, `'Alvará de Localização'`, `'Alvará do Corpo de Bombeiros'`.
- `recharts` já é dependência — não adicionar libs.

---

### Task 1: Métricas puras `painelMetrics` + testes

**Files:**
- Create: `src/lib/painelMetrics.ts`, `src/lib/painelMetrics.test.ts`
- Modify: `package.json` (incluir o teste no script `test`)

**Interfaces:**
- Produces: `situacaoDocumento`, `contarSituacoes`, `conformidade`, `baldesAlvara`, `conformidadePorTipo`.

- [ ] **Step 1: Teste (falha)**

Create `src/lib/painelMetrics.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situacaoDocumento, contarSituacoes, conformidade, baldesAlvara, conformidadePorTipo } from './painelMetrics.js';

const hoje = new Date(2026, 10, 16); // 2026-11-16 local
const doc = (status: string, expiry: string | null, type = 'Alvará Sanitário') => ({ status, expiry_date: expiry, type });

test('situação por status/validade', () => {
  assert.equal(situacaoDocumento(doc('pendente', null), hoje), 'pendente');
  assert.equal(situacaoDocumento(doc('reprovado', null), hoje), 'irregular');
  assert.equal(situacaoDocumento(doc('valido', '2026-01-01'), hoje), 'irregular'); // vencido
  assert.equal(situacaoDocumento(doc('valido', null), hoje), 'regular');
  assert.equal(situacaoDocumento(doc('valido', '2027-06-30'), hoje), 'regular');   // > 30 dias
  assert.equal(situacaoDocumento(doc('valido', '2026-12-10'), hoje), 'vencendo');  // dentro de 30 dias
  assert.equal(situacaoDocumento(doc('valido', '2026-12-16'), hoje), 'vencendo');  // borda: exatamente +30 dias
  assert.equal(situacaoDocumento(doc('historico', null), hoje), 'historico');
});

test('contarSituacoes ignora histórico', () => {
  const c = contarSituacoes([doc('valido', null), doc('valido', '2026-01-01'), doc('pendente', null), doc('historico', null)], hoje);
  assert.deepEqual(c, { regular: 1, vencendo: 0, irregular: 1, pendente: 1, total: 3 });
});

test('conformidade: conforme/(conforme+irregular), sem pendentes', () => {
  assert.equal(conformidade([doc('valido', null), doc('valido', '2026-01-01'), doc('pendente', null)], hoje), 50);
  assert.equal(conformidade([doc('pendente', null)], hoje), 0); // denominador 0
});

test('baldesAlvara filtra por tipo', () => {
  const docs = [doc('valido', null, 'Alvará Sanitário'), doc('valido', '2026-01-01', 'Alvará Sanitário'), doc('valido', null, 'CNES')];
  assert.deepEqual(baldesAlvara(docs, 'Alvará Sanitário', hoje), { noPrazo: 1, aVencer: 0, vencido: 1 });
});

test('conformidadePorTipo', () => {
  const docs = [doc('valido', null, 'Alvará Sanitário'), doc('valido', '2026-01-01', 'Alvará Sanitário')];
  assert.deepEqual(conformidadePorTipo(docs, 'Alvará Sanitário', hoje), { conforme: 1, total: 2, pct: 50 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/painelMetrics.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

Create `src/lib/painelMetrics.ts`:
```ts
import { statusDocumento } from './documentoStatus.js';

export type Situacao = 'regular' | 'vencendo' | 'irregular' | 'pendente' | 'historico';

// Data local +N dias em YYYY-MM-DD.
function maisDias(hoje: Date, dias: number): string {
  const d = new Date(hoje); d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function situacaoDocumento(doc: { status: string; expiry_date?: string | null }, hoje: Date = new Date()): Situacao {
  const st = statusDocumento(doc, hoje);
  if (st === 'historico') return 'historico';
  if (st === 'pendente') return 'pendente';
  if (st === 'reprovado' || st === 'vencido') return 'irregular';
  // aprovado (válido, validade >= hoje ou ausente)
  if (doc.expiry_date && String(doc.expiry_date).slice(0, 10) <= maisDias(hoje, 30)) return 'vencendo';
  return 'regular';
}

export interface Contagem { regular: number; vencendo: number; irregular: number; pendente: number; total: number }

export function contarSituacoes(docs: any[], hoje: Date = new Date()): Contagem {
  const c: Contagem = { regular: 0, vencendo: 0, irregular: 0, pendente: 0, total: 0 };
  for (const d of docs) {
    const s = situacaoDocumento(d, hoje);
    if (s === 'historico') continue;
    (c as any)[s]++; c.total++;
  }
  return c;
}

export function conformidade(docs: any[], hoje: Date = new Date()): number {
  const c = contarSituacoes(docs, hoje);
  const conforme = c.regular + c.vencendo;
  const denom = conforme + c.irregular;
  return denom === 0 ? 0 : Math.round((conforme / denom) * 100);
}

export function baldesAlvara(docs: any[], tipoNome: string, hoje: Date = new Date()) {
  const c = contarSituacoes(docs.filter(d => d.type === tipoNome), hoje);
  return { noPrazo: c.regular, aVencer: c.vencendo, vencido: c.irregular };
}

export function conformidadePorTipo(docs: any[], tipoNome: string, hoje: Date = new Date()) {
  const c = contarSituacoes(docs.filter(d => d.type === tipoNome), hoje);
  const conforme = c.regular + c.vencendo;
  const total = conforme + c.irregular;
  return { conforme, total, pct: total === 0 ? 0 : Math.round((conforme / total) * 100) };
}
```

- [ ] **Step 4: Rodar e ver passar; incluir no `test`**

Run: `node --import tsx --test src/lib/painelMetrics.test.ts`
Expected: PASS.
Modify `package.json`: acrescentar ` src/lib/painelMetrics.test.ts` ao fim do script `test`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/painelMetrics.ts src/lib/painelMetrics.test.ts package.json
git commit -m "feat(documentos): métricas puras do Painel de Controle + testes"
```

---

### Task 2: `PainelControle` (casca + Overview) + wiring

**Files:**
- Create: `src/pages/documentos/PainelControle.tsx`
- Modify: `src/pages/documentos/GestaoDocumental.tsx` (renderizar no `aba === 'bi'`)

**Interfaces:**
- Consumes: `GET /api/documents`, `fetchApi`, `situacaoDocumento`/`contarSituacoes`/`conformidade`/`conformidadePorTipo`, `providerAudience`, `recharts`.

- [ ] **Step 1: Criar o componente (casca + Overview; aba Alvarás como placeholder)**

Create `src/pages/documentos/PainelControle.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { fetchApi } from '../../lib/api';
import { providerAudience } from '../../lib/providerAudience.js';
import { contarSituacoes, conformidade, conformidadePorTipo } from '../../lib/painelMetrics.js';

const ALVARAS = ['Alvará Sanitário', 'Alvará de Localização', 'Alvará do Corpo de Bombeiros'];
type Sub = 'overview' | 'alvaras' | 'cert' | 'escol';

export default function PainelControle({ audiencia }: { audiencia: 'medicos' | 'rede' }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [sub, setSub] = useState<Sub>('overview');

  useEffect(() => { fetchApi('/documents').then(setDocs).catch(e => setErro(e.message)); }, []);

  const hoje = new Date();
  const base = useMemo(() => docs
    .filter(d => d.type_id != null)
    .filter(d => providerAudience(d.person_type ?? null, d.provider_group ?? null) === audiencia), [docs, audiencia]);

  const c = useMemo(() => contarSituacoes(base, hoje), [base]);

  return (
    <div className="space-y-4">
      {erro && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Regulares" valor={c.regular} cor="text-emerald-700" bg="bg-emerald-50" />
        <StatCard label="Irregulares" valor={c.irregular} cor="text-red-700" bg="bg-red-50" />
        <StatCard label="Vencendo" valor={c.vencendo} cor="text-amber-700" bg="bg-amber-50" />
        <StatCard label="Pendentes" valor={c.pendente} cor="text-blue-700" bg="bg-blue-50" />
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([['overview', 'Overview'], ['alvaras', 'Alvarás de Prestadores'], ['cert', 'Certificações e Dados Técnicos'], ['escol', 'Escolaridade']] as [Sub, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${sub === id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'overview' && <Overview base={base} c={c} hoje={hoje} />}
      {sub === 'alvaras' && <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Alvarás — em construção</div>}
      {sub === 'cert' && <EmBreve titulo="Certificações e Dados Técnicos" />}
      {sub === 'escol' && <EmBreve titulo="Escolaridade" />}
    </div>
  );
}

function Overview({ base, c, hoje }: { base: any[]; c: ReturnType<typeof contarSituacoes>; hoje: Date }) {
  const barData = [
    { nome: 'Regulares', valor: c.regular, fill: '#10b981' },
    { nome: 'Irregulares', valor: c.irregular, fill: '#ef4444' },
  ];
  const pct = conformidade(base, hoje);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card titulo="Documentos Regulares × Irregulares">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="nome" /><YAxis allowDecimals={false} /><Tooltip />
            <Bar dataKey="valor" radius={[4, 4, 0, 0]}>{barData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card titulo="Taxa de Conformidade (documentos legais)">
        <Donut pct={pct} />
      </Card>

      <Card titulo="Conformidade por alvará" className="lg:col-span-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {['Alvará Sanitário', 'Alvará de Localização', 'Alvará do Corpo de Bombeiros'].map(nome => {
            const t = conformidadePorTipo(base, nome, hoje);
            return (
              <div key={nome} className="rounded-lg border border-gray-100 p-4">
                <p className="text-sm text-gray-600">{nome}</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">{t.pct}%</p>
                <p className="text-xs text-gray-400">{t.conforme}/{t.total} conformes</p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

export function Donut({ pct }: { pct: number }) {
  const data = [{ name: 'Conforme', value: pct }, { name: 'resto', value: 100 - pct }];
  return (
    <div className="relative" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={70} outerRadius={95} startAngle={90} endAngle={-270} stroke="none">
            <Cell fill="#10b981" /><Cell fill="#e5e7eb" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-gray-900">{pct}%</span>
        <span className="text-xs text-gray-400">Conforme</span>
      </div>
    </div>
  );
}

function StatCard({ label, valor, cor, bg }: { label: string; valor: number; cor: string; bg: string }) {
  return (
    <div className={`rounded-xl border border-gray-100 p-4 ${bg}`}>
      <p className={`text-3xl font-bold ${cor}`}>{valor}</p>
      <p className="text-sm text-gray-600">{label}</p>
    </div>
  );
}

function Card({ titulo, children, className = '' }: { titulo: string; children: any; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-4 ${className}`}>
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{titulo}</h3>
      {children}
    </div>
  );
}

function EmBreve({ titulo }: { titulo: string }) {
  return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">{titulo} — em breve</div>;
}
```

- [ ] **Step 2: Wire no `GestaoDocumental.tsx`**

Modify `src/pages/documentos/GestaoDocumental.tsx`: importar `PainelControle` e trocar
`{aba === 'bi' && <EmBreve titulo="Painel de Controle" />}` por
`{aba === 'bi' && <PainelControle audiencia={audiencia} />}`. (A função `EmBreve` do shell continua usada pela aba Matriz Legal.)

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` → limpo. Boot check: `APP_ENV=dev npm run dev` em background (dummy `JWT_SECRET` + 32-char `IP_HASH_SECRET`; `PORT=3917` se 3000 ocupado), ~6s, "Server running" sem stack trace, parar.

- [ ] **Step 4: Commit**
```bash
git add src/pages/documentos/PainelControle.tsx src/pages/documentos/GestaoDocumental.tsx
git commit -m "feat(documentos): Painel de Controle — cards + Overview (barra, donut, conformidade)"
```

---

### Task 3: Aba Alvarás de Prestadores

**Files:**
- Modify: `src/pages/documentos/PainelControle.tsx`

**Interfaces:**
- Consumes: `baldesAlvara`, `conformidade` (restrita aos alvarás), `Donut` (exportado na Task 2).

- [ ] **Step 1: Componente da aba Alvarás**

Modify `src/pages/documentos/PainelControle.tsx`: importar `baldesAlvara` de `../../lib/painelMetrics.js` (somar ao import existente) e `BarChart` já está importado. Trocar o placeholder
`{sub === 'alvaras' && <div ...>Alvarás — em construção</div>}` por `{sub === 'alvaras' && <Alvaras base={base} hoje={hoje} />}` e adicionar o componente:
```tsx
function Alvaras({ base, hoje }: { base: any[]; hoje: Date }) {
  const somenteAlvaras = base.filter(d => ALVARAS.includes(d.type));
  const pctGeral = conformidade(somenteAlvaras, hoje);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {ALVARAS.map(nome => {
        const b = baldesAlvara(base, nome, hoje);
        const data = [
          { nome: 'No Prazo', valor: b.noPrazo, fill: '#10b981' },
          { nome: 'A Vencer', valor: b.aVencer, fill: '#f59e0b' },
          { nome: 'Vencido', valor: b.vencido, fill: '#ef4444' },
        ];
        return (
          <Card key={nome} titulo={nome}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart layout="vertical" data={data}>
                <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="nome" width={80} /><Tooltip />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]}>{data.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        );
      })}
      <Card titulo="Taxa de Conformidade Geral de Alvarás">
        <Donut pct={pctGeral} />
      </Card>
    </div>
  );
}
```
> `conformidade`, `baldesAlvara`, `Card`, `Donut`, `ResponsiveContainer`, `BarChart`, `XAxis`, `YAxis`, `Tooltip`, `Cell`, `ALVARAS` já estão no arquivo (definidos/importados na Task 2); só garanta que `baldesAlvara` foi acrescentado ao import de `painelMetrics.js`.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` → limpo. Boot check como na Task 2.

- [ ] **Step 3: Commit**
```bash
git add src/pages/documentos/PainelControle.tsx
git commit -m "feat(documentos): Painel de Controle — aba Alvarás (barras por alvará + conformidade geral)"
```

---

### Task 4: Dados de teste para o dashboard

**Files:**
- Modify: `db/seed-documentos.ts`

**Interfaces:**
- Produces: documentos cobrindo as 4 situações por prestador.

- [ ] **Step 1: Ampliar a matriz de seed**

Modify `db/seed-documentos.ts`: na constante `MATRIZ`, garantir cobertura das 4 situações com datas relativas a hoje. Substituir o array por (datas fixas que, em nov/2026, dão: regular, vencendo ≤30d, vencido, pendente, reprovado):
```ts
const MATRIZ: Array<[string, string, string | null, string | null, string | null]> = [
  ['Alvará Sanitário',              'valido',    '2026-02-15', '2027-06-30', null],                  // Regular
  ['Alvará de Localização',         'valido',    '2026-01-10', '2026-12-05', null],                  // Vencendo (≤30 dias)
  ['Alvará do Corpo de Bombeiros',  'valido',    '2024-05-01', '2025-05-01', null],                  // Vencido (irregular)
  ['CNES',                          'pendente',  '2026-11-01', null,          null],                 // Pendente
  ['Contrato Social',               'reprovado', '2026-10-01', null,          'Documento ilegível.'], // Irregular (reprovado)
  ['CRM do Responsável Técnico',    'valido',    '2015-09-30', null,          null],                 // Regular (sem validade)
];
```
(O resto do script — trava anti-produção, DELETE dos `type_id != null`, inserts, verificação — fica igual.)

- [ ] **Step 2: Rodar o seed no DEV**

Run: `APP_ENV=dev npm run db:seed-documentos -- --commit`
Expected: `inseridos: 18 documentos` (6 tipos × 3 prestadores) e a contagem por status impressa.

- [ ] **Step 3: Commit**
```bash
git add db/seed-documentos.ts
git commit -m "chore(dev): seed-documentos cobre as 4 situações do dashboard"
```

---

## Self-Review

**Cobertura da spec:**
- Métricas puras (situação/contagem/conformidade/baldes/porTipo) → Task 1. ✔
- Cards Regulares/Irregulares/Vencendo/Pendentes → Task 2. ✔
- Overview (barra + donut + tiles por alvará) → Task 2. ✔
- Aba Alvarás (barras por alvará + donut geral) → Task 3. ✔
- Casca com sub-abas + Certificações/Escolaridade como "em breve" → Task 2. ✔
- Agregação no cliente a partir de GET /api/documents, filtrada por audiência + type_id → Task 2. ✔
- Gráficos com recharts (sem libs novas) → Tasks 2/3. ✔
- Dados de teste → Task 4. ✔
- Fora de escopo (Verificar/Isento, Certificações/Escolaridade reais, filtros município/status) → stubs/ausentes. ✔

**Placeholders:** nenhum TODO/TBD; todo passo tem código ou comando. O único ponto de atenção em implementação (sinalizado inline na Task 3) é não re-declarar o que a Task 2 já criou.

**Consistência de tipos:** `situacaoDocumento`/`contarSituacoes`/`conformidade`/`baldesAlvara`/`conformidadePorTipo` com as mesmas assinaturas entre Task 1 (definição) e Tasks 2/3 (uso); `Donut` e `Card` exportados/definidos na Task 2 e reusados na Task 3.
