# Verificar (obrigatórios faltantes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar ao admin, por prestador, quais documentos obrigatórios (pela função, via Matriz Legal) estão sem um documento aprovado e vigente, e o motivo (ausente/vencido/reprovado/pendente).

**Architecture:** Duas funções puras (`statusPorTipo`, `faltantesPara`) reusando `statusDocumento` e `obrigatoriosPara`; um endpoint admin que cruza prestadores × matriz (só tipos ativos) × documentos e monta os faltantes por prestador; uma sub-aba `Verificar` no Painel de Controle que lista prestador × faltantes.

**Tech Stack:** TypeScript (ESM `.js` imports), Postgres (`pg`), Express, React + `fetchApi`, `node:test`. Sem libs novas.

## Global Constraints

- Imports relativos entre módulos TS usam sufixo `.js` (ESM/tsx).
- Reusar: `statusDocumento`/`StatusDoc` de `src/lib/documentoStatus.ts`; `obrigatoriosPara` de `src/lib/matrizLegal.ts`; `deriveProviderRole` (já importado em `server.ts:10`); `providerAudience` de `src/lib/providerAudience.ts`.
- Regra de faltante: tipo obrigatório **sem** nenhum doc com status efetivo `aprovado`. Motivo = `ausente` (sem doc) ou o status efetivo do doc mais recente (`vencido`/`reprovado`/`pendente`).
- Requisitos considerados: **só de tipos ativos** (JOIN com `document_types ... ativo = true`).
- Documentos considerados: `type_id IS NOT NULL AND status <> 'historico'`.
- Endpoint admin: `authenticate, requireAdmin`. Frontend: `fetchApi` de `src/lib/api.ts`.
- Testes `node:test`; arquivo novo entra no script `"test"` do `package.json`.
- Rótulos de função: cooperado→"Médico Cooperado", credenciado→"Médico Credenciado", pf_nao_medico→"PF não médico", prestador→"Prestador PJ".

---

### Task 1: Funções puras `statusPorTipo` e `faltantesPara`

**Files:**
- Create: `src/lib/verificar.ts`
- Test: `src/lib/verificar.test.ts`
- Modify: `package.json` (registrar o teste)

**Interfaces:**
- Consumes: `statusDocumento`, `StatusDoc` de `./documentoStatus.js`.
- Produces:
  - `type MotivoFaltante = 'ausente' | 'vencido' | 'reprovado' | 'pendente'`
  - `type Faltante = { type_id: number; motivo: MotivoFaltante }`
  - `function statusPorTipo(docs, hoje?): Map<number, StatusDoc>`
  - `function faltantesPara(requiredTypeIds: Iterable<number>, porTipo: Map<number, StatusDoc>): Faltante[]`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/verificar.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusPorTipo, faltantesPara } from './verificar.js';

// hoje fixo (local): 2026-11-16
const hoje = new Date(2026, 10, 16);

test('statusPorTipo: aprovado vence os demais do mesmo tipo', () => {
  const m = statusPorTipo([
    { type_id: 1, status: 'reprovado', expiry_date: null, upload_date: '2026-02-01' },
    { type_id: 1, status: 'valido', expiry_date: '2027-01-01', upload_date: '2026-01-01' },
  ], hoje);
  assert.equal(m.get(1), 'aprovado');
});

test('statusPorTipo: sem aprovado, pega o status do mais recente', () => {
  const m = statusPorTipo([
    { type_id: 2, status: 'reprovado', expiry_date: null, upload_date: '2026-01-01' },
    { type_id: 2, status: 'pendente', expiry_date: null, upload_date: '2026-02-01' },
  ], hoje);
  assert.equal(m.get(2), 'pendente');
});

test('statusPorTipo: valido com validade passada vira vencido', () => {
  const m = statusPorTipo([
    { type_id: 3, status: 'valido', expiry_date: '2020-01-01', upload_date: '2019-01-01' },
  ], hoje);
  assert.equal(m.get(3), 'vencido');
});

test('statusPorTipo: ignora type_id nulo', () => {
  const m = statusPorTipo([
    { type_id: null, status: 'valido', expiry_date: null, upload_date: '2026-01-01' },
  ], hoje);
  assert.equal(m.size, 0);
});

test('faltantesPara: aprovado não é faltante; os demais com motivo; ausente quando não há doc', () => {
  const porTipo = new Map<number, any>([[1, 'aprovado'], [2, 'pendente'], [3, 'vencido']]);
  const f = faltantesPara([1, 2, 3, 4], porTipo);
  assert.deepEqual(f, [
    { type_id: 2, motivo: 'pendente' },
    { type_id: 3, motivo: 'vencido' },
    { type_id: 4, motivo: 'ausente' },
  ]);
});

test('faltantesPara: reprovado vira motivo reprovado', () => {
  const f = faltantesPara([5], new Map<number, any>([[5, 'reprovado']]));
  assert.deepEqual(f, [{ type_id: 5, motivo: 'reprovado' }]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/verificar.test.ts`
Expected: FAIL (módulo `./verificar.js` não existe).

- [ ] **Step 3: Implementar**

Create `src/lib/verificar.ts`:

```ts
// Verificar: a partir dos documentos de um prestador e dos tipos obrigatórios da sua função,
// quais documentos obrigatórios estão sem um doc aprovado e vigente, e por quê.
// Puro; reusa statusDocumento. O chamador (server) já filtra documentos 'historico'.
import { statusDocumento, type StatusDoc } from './documentoStatus.js';

export type MotivoFaltante = 'ausente' | 'vencido' | 'reprovado' | 'pendente';
export type Faltante = { type_id: number; motivo: MotivoFaltante };

type DocLite = { type_id: number | null; status: string; expiry_date: string | null; upload_date?: string | null };

// Status efetivo "melhor" por tipo: 'aprovado' vence; senão o status do doc de maior upload_date.
export function statusPorTipo(docs: DocLite[], hoje: Date = new Date()): Map<number, StatusDoc> {
  const aprovado = new Set<number>();
  const melhor = new Map<number, DocLite>();
  for (const d of docs) {
    if (d.type_id == null) continue;
    const id = d.type_id;
    if (statusDocumento(d, hoje) === 'aprovado') { aprovado.add(id); continue; }
    if (aprovado.has(id)) continue;
    const atual = melhor.get(id);
    if (!atual || String(d.upload_date ?? '') > String(atual.upload_date ?? '')) melhor.set(id, d);
  }
  const out = new Map<number, StatusDoc>();
  for (const id of aprovado) out.set(id, 'aprovado');
  for (const [id, d] of melhor) if (!out.has(id)) out.set(id, statusDocumento(d, hoje));
  return out;
}

// Tipos obrigatórios sem status 'aprovado' → faltantes (ordenados por type_id).
export function faltantesPara(requiredTypeIds: Iterable<number>, porTipo: Map<number, StatusDoc>): Faltante[] {
  const out: Faltante[] = [];
  for (const id of requiredTypeIds) {
    const s = porTipo.get(id);
    if (s === 'aprovado') continue;
    const motivo: MotivoFaltante = (s === 'vencido' || s === 'reprovado' || s === 'pendente') ? s : 'ausente';
    out.push({ type_id: id, motivo });
  }
  out.sort((a, b) => a.type_id - b.type_id);
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test src/lib/verificar.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Registrar o teste no script `test`**

Em `package.json`, no fim do valor do script `"test"` (antes da aspa final), acrescentar:
` src/lib/verificar.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/verificar.ts src/lib/verificar.test.ts package.json
git commit -m "feat(documentos): statusPorTipo e faltantesPara — base do Verificar"
```

---

### Task 2: Endpoint `GET /api/admin/document-verificar`

**Files:**
- Modify: `server.ts` (imports no topo + inserir a rota após a `PUT /api/admin/document-requirements`, que termina por volta da linha 2420)

**Interfaces:**
- Consumes: `obrigatoriosPara` (`./src/lib/matrizLegal.js`), `statusPorTipo`/`faltantesPara` (`./src/lib/verificar.js`), `deriveProviderRole` (já importado), `query`, `authenticate`, `requireAdmin` (em escopo).
- Produces: `GET /api/admin/document-verificar` → `{ provider_id, name, person_type, provider_group, role, faltantes: {type_id, nome, motivo}[] }[]` (só prestadores com ≥1 faltante).

- [ ] **Step 1: Adicionar os imports**

Junto do `import { marcoVencimento, diasVencido } from './src/lib/vencimentoAlertas.js';` (perto da linha 37), adicionar:

```ts
import { obrigatoriosPara } from './src/lib/matrizLegal.js';
import { statusPorTipo, faltantesPara } from './src/lib/verificar.js';
```

- [ ] **Step 2: Inserir a rota**

Logo após o fechamento de `app.put('/api/admin/document-requirements', ...)` (termina com `});`), inserir:

```ts
  // Verificar: por prestador, documentos obrigatórios (pela função) sem doc aprovado vigente.
  app.get('/api/admin/document-verificar', authenticate, requireAdmin, async (_req: any, res) => {
    try {
      const { rows: provs } = await query('SELECT id, name, person_type, provider_group FROM providers');
      const { rows: reqs } = await query(
        `SELECT r.type_id, r.role FROM document_type_requirements r
           JOIN document_types t ON t.id = r.type_id AND t.ativo = true`);
      const { rows: tipos } = await query('SELECT id, nome FROM document_types WHERE ativo = true');
      const { rows: docs } = await query(
        `SELECT provider_id, type_id, status, expiry_date, upload_date
           FROM documents WHERE type_id IS NOT NULL AND status <> 'historico'`);

      const nomePorTipo = new Map<number, string>(tipos.map((t: any) => [Number(t.id), t.nome]));
      const reqsNorm = reqs.map((r: any) => ({ type_id: Number(r.type_id), role: r.role }));
      const docsPorProv = new Map<number, any[]>();
      for (const d of docs) {
        const pid = Number(d.provider_id);
        const arr = docsPorProv.get(pid) ?? [];
        arr.push({ type_id: d.type_id == null ? null : Number(d.type_id), status: d.status, expiry_date: d.expiry_date, upload_date: d.upload_date });
        docsPorProv.set(pid, arr);
      }

      const out: any[] = [];
      for (const p of provs) {
        const role = deriveProviderRole(p.person_type, p.provider_group);
        const required = obrigatoriosPara(role, reqsNorm);
        if (required.size === 0) continue;
        const porTipo = statusPorTipo(docsPorProv.get(Number(p.id)) ?? []);
        const faltantes = faltantesPara(required, porTipo)
          .map(f => ({ ...f, nome: nomePorTipo.get(f.type_id) ?? '' }));
        if (faltantes.length) {
          out.push({ provider_id: Number(p.id), name: p.name, person_type: p.person_type, provider_group: p.provider_group, role, faltantes });
        }
      }
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 3: Verificar compilação**

Run: `npm run lint`
Expected: `tsc --noEmit` sem erros. Corrigir import/tipos se acusar.

- [ ] **Step 4: Sanidade no DEV (read-only, sem enviar nada)**

```bash
APP_ENV=dev node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const {rows}=await query(\"SELECT count(*)::int n FROM document_type_requirements\");console.log('requisitos na matriz:', rows[0].n);await pool.end();})"
```

Expected: imprime quantos requisitos existem. (Com a matriz vazia o endpoint devolve `[]` — correto.)

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(documentos): endpoint document-verificar (obrigatórios faltantes por prestador)"
```

---

### Task 3: Sub-aba "Verificar" no Painel de Controle

**Files:**
- Create: `src/pages/documentos/Verificar.tsx`
- Modify: `src/pages/documentos/PainelControle.tsx` (tipo `Sub`, lista de sub-abas, render, import)

**Interfaces:**
- Consumes: `GET /api/admin/document-verificar` (Task 2) via `fetchApi`; `providerAudience`.
- Produces: componente default `Verificar` com prop `{ audiencia: 'medicos' | 'rede' }`.

- [ ] **Step 1: Criar o componente**

Create `src/pages/documentos/Verificar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { providerAudience } from '../../lib/providerAudience.js';

type Motivo = 'ausente' | 'vencido' | 'reprovado' | 'pendente';
type Faltante = { type_id: number; nome: string; motivo: Motivo };
type Linha = { provider_id: number; name: string; person_type: string | null; provider_group: string | null; role: string; faltantes: Faltante[] };

const ROLE_LABEL: Record<string, string> = {
  cooperado: 'Médico Cooperado', credenciado: 'Médico Credenciado',
  pf_nao_medico: 'PF não médico', prestador: 'Prestador PJ',
};
const MOTIVO: Record<Motivo, { label: string; cls: string }> = {
  ausente: { label: 'não enviado', cls: 'bg-gray-100 text-gray-600' },
  vencido: { label: 'vencido', cls: 'bg-red-50 text-red-700' },
  reprovado: { label: 'reprovado', cls: 'bg-red-50 text-red-700' },
  pendente: { label: 'pendente', cls: 'bg-blue-50 text-blue-700' },
};

export default function Verificar({ audiencia }: { audiencia: 'medicos' | 'rede' }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetchApi('/admin/document-verificar')
      .then(setLinhas).catch(e => setErro(e.message)).finally(() => setCarregando(false));
  }, []);

  const vis = linhas.filter(l => providerAudience(l.person_type, l.provider_group) === audiencia);

  if (carregando) return <div className="p-8 text-center text-gray-400">Carregando…</div>;
  if (erro && !linhas.length)
    return <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>;
  if (!vis.length)
    return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Nenhuma pendência.</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">{vis.length} prestador(es) com documentos obrigatórios pendentes.</p>
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Prestador</th>
              <th className="px-4 py-3 font-medium">Função</th>
              <th className="px-4 py-3 font-medium">Documentos faltantes</th>
            </tr>
          </thead>
          <tbody>
            {vis.map(l => (
              <tr key={l.provider_id} className="border-b border-gray-50 align-top last:border-0">
                <td className="px-4 py-3 text-gray-900">{l.name}</td>
                <td className="px-4 py-3 text-gray-600">{ROLE_LABEL[l.role] ?? l.role}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {l.faltantes.map(f => (
                      <span key={f.type_id} className={`rounded-full px-2 py-0.5 text-xs ${MOTIVO[f.motivo]?.cls ?? 'bg-gray-100 text-gray-600'}`}>
                        {f.nome} · {MOTIVO[f.motivo]?.label ?? f.motivo}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar a sub-aba no `PainelControle.tsx`**

(a) No import, junto dos outros do topo:
```ts
import Verificar from './Verificar';
```

(b) No tipo `Sub` (linha 8), acrescentar `'verificar'`:
```ts
type Sub = 'overview' | 'alvaras' | 'verificar' | 'cert' | 'escol';
```

(c) Na lista de sub-abas (linha 38), inserir `['verificar', 'Verificar']` após `['alvaras', ...]`:
```tsx
        {([['overview', 'Overview'], ['alvaras', 'Alvarás de Prestadores'], ['verificar', 'Verificar'], ['cert', 'Certificações e Dados Técnicos'], ['escol', 'Escolaridade']] as [Sub, string][]).map(([id, label]) => (
```

(d) No bloco de render (após a linha `{sub === 'alvaras' && ...}`), inserir:
```tsx
      {sub === 'verificar' && <Verificar audiencia={audiencia} />}
```

- [ ] **Step 3: Verificar compilação e build**

Run: `npm run lint && npm run build`
Expected: `tsc` sem erros; build ok.

- [ ] **Step 4: Commit**

```bash
git add src/pages/documentos/Verificar.tsx src/pages/documentos/PainelControle.tsx
git commit -m "feat(documentos): sub-aba Verificar no Painel de Controle"
```

---

## Capstone (após as 3 tasks)

- [ ] `npm test` — toda a suíte verde (inclui `verificar.test.ts`).
- [ ] `npm run lint` — `tsc` limpo.
- [ ] `npm run build` — build ok.
- [ ] Revisão final da branch (requesting-code-review) + correções.
- [ ] Smoke no navegador (admin): marcar na Matriz Legal um obrigatório para uma função; na sub-aba Verificar, o prestador daquela função aparece com o documento faltante e o motivo certo.
- [ ] **Reiniciar o servidor dev** antes do smoke (o `tsx server.ts` não recarrega rotas novas sozinho).
- [ ] Push da `dev` só após o OK da Katy.

## Notas de verificação
- Lógica pura (`statusPorTipo`, `faltantesPara`) coberta por teste. O endpoint monta dados e é verificado por `tsc` + o smoke do navegador. A query usa só tipos ativos (resolve a nota da Matriz Legal).
