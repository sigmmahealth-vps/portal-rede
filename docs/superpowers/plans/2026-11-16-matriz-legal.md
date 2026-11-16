# Matriz Legal editável — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin defina, numa grade editável, quais tipos de documento são obrigatórios para cada função de prestador (cooperado, credenciado, PF não médico, prestador PJ).

**Architecture:** Tabela de junção por presença `document_type_requirements (type_id, role)`; dois endpoints admin (ler a matriz / alternar uma célula) espelhando os de `document-types`; um componente de grade `MatrizLegal.tsx` na aba Matriz Legal com save otimista. Uma função pura `obrigatoriosPara` (base do Verificar futuro).

**Tech Stack:** TypeScript (ESM, imports `.js`), Postgres (`pg`), Express, React + `fetchApi`, `node:test`. Sem libs novas.

## Global Constraints

- Imports relativos entre módulos TS usam sufixo `.js` (ESM/tsx).
- As 4 funções (roles): `cooperado`, `credenciado`, `pf_nao_medico`, `prestador`. Reusar a constante já exportada `PROVIDER_ACCESS_ROLES` de `db/provider-role.ts` para validar (mesmas 4).
- Rótulos legíveis na UI: `cooperado`→"Médico Cooperado", `credenciado`→"Médico Credenciado", `pf_nao_medico`→"PF não médico", `prestador`→"Prestador PJ".
- Endpoints admin usam `authenticate, requireAdmin` (padrão de `/api/admin/document-types`).
- Frontend chama o backend via `fetchApi(endpoint, options)` de `src/lib/api.ts` (base `/api`, cookie incluso, JSON por padrão).
- Testes `node:test`; todo arquivo de teste novo entra no script `"test"` do `package.json`.
- Migration nova: número `0063` (a última é `0062_document_types.sql`).

---

### Task 1: Migration da tabela `document_type_requirements`

**Files:**
- Create: `db/migrations/0063_document_type_requirements.sql`

**Interfaces:**
- Produces: tabela `document_type_requirements(type_id bigint, role text, PRIMARY KEY(type_id, role))` usada pelas Tasks 3 e 4.

- [ ] **Step 1: Escrever a migration**

Create `db/migrations/0063_document_type_requirements.sql`:

```sql
-- 0063_document_type_requirements.sql
-- Matriz Legal: quais tipos de documento são obrigatórios por função de prestador.
-- Junção por presença — linha existe ⇒ obrigatório para aquela função.
CREATE TABLE IF NOT EXISTS document_type_requirements (
  type_id bigint NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  role    text   NOT NULL CHECK (role IN ('cooperado','credenciado','pf_nao_medico','prestador')),
  PRIMARY KEY (type_id, role)
);
```

- [ ] **Step 2: Aplicar no DEV e verificar**

Run: `APP_ENV=dev npm run db:migrate`
Expected: aplica `0063` sem erro (idempotente; `schema_migrations` registra). Em seguida confirmar a tabela:

```bash
APP_ENV=dev node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const {rows}=await query(\"SELECT column_name,data_type FROM information_schema.columns WHERE table_name='document_type_requirements' ORDER BY ordinal_position\");console.table(rows);await pool.end();})"
```

Expected: colunas `type_id` (bigint) e `role` (text).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0063_document_type_requirements.sql
git commit -m "feat(documentos): migration document_type_requirements (Matriz Legal)"
```

---

### Task 2: Função pura `obrigatoriosPara`

**Files:**
- Create: `src/lib/matrizLegal.ts`
- Test: `src/lib/matrizLegal.test.ts`
- Modify: `package.json` (registrar o teste)

**Interfaces:**
- Produces:
  - `type Requirement = { type_id: number; role: string }`
  - `function obrigatoriosPara(role: string, reqs: Requirement[]): Set<number>` — conjunto de `type_id` obrigatórios para `role`.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/matrizLegal.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obrigatoriosPara, type Requirement } from './matrizLegal.js';

const reqs: Requirement[] = [
  { type_id: 1, role: 'cooperado' },
  { type_id: 2, role: 'cooperado' },
  { type_id: 2, role: 'prestador' },
  { type_id: 3, role: 'prestador' },
];

test('retorna os type_id obrigatórios da função', () => {
  assert.deepEqual(obrigatoriosPara('cooperado', reqs), new Set([1, 2]));
  assert.deepEqual(obrigatoriosPara('prestador', reqs), new Set([2, 3]));
});

test('função sem obrigatórios → Set vazio', () => {
  assert.deepEqual(obrigatoriosPara('credenciado', reqs), new Set());
});

test('função desconhecida → Set vazio', () => {
  assert.deepEqual(obrigatoriosPara('inexistente', reqs), new Set());
});

test('lista vazia → Set vazio', () => {
  assert.deepEqual(obrigatoriosPara('cooperado', []), new Set());
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/matrizLegal.test.ts`
Expected: FAIL (módulo `./matrizLegal.js` não existe).

- [ ] **Step 3: Implementar**

Create `src/lib/matrizLegal.ts`:

```ts
// Matriz Legal: a partir da lista plana de requisitos (type_id × role), o conjunto de
// type_id obrigatórios para uma função. Puro; base do "Verificar" (fatia seguinte).

export type Requirement = { type_id: number; role: string };

export function obrigatoriosPara(role: string, reqs: Requirement[]): Set<number> {
  const out = new Set<number>();
  for (const r of reqs) if (r.role === role) out.add(r.type_id);
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test src/lib/matrizLegal.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Registrar o teste no script `test`**

Em `package.json`, no fim do valor do script `"test"` (antes da aspa final), acrescentar:
` src/lib/matrizLegal.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/matrizLegal.ts src/lib/matrizLegal.test.ts package.json
git commit -m "feat(documentos): obrigatoriosPara — base da Matriz Legal"
```

---

### Task 3: Endpoints admin da matriz

**Files:**
- Modify: `server.ts` (inserir duas rotas após a rota `DELETE /api/admin/document-types/:id`, que termina por volta da linha 2382)

**Interfaces:**
- Consumes: tabela da Task 1; `PROVIDER_ACCESS_ROLES` — já importado em `server.ts:10` (`import { ..., PROVIDER_ACCESS_ROLES } from './db/provider-role.js'`), usar direto.
- Produces:
  - `GET /api/admin/document-requirements` → `{ types: {id,nome,categoria,obrigatorio,escopo,ativo,ordem}[], requirements: {type_id,role}[] }`
  - `PUT /api/admin/document-requirements` body `{ type_id:number, role:string, obrigatorio:boolean }` → `{ ok:true }`

- [ ] **Step 1: Inserir as duas rotas**

Logo após o fechamento da rota `app.delete('/api/admin/document-types/:id', ...)` (termina com `});` por volta da linha 2382), inserir:

```ts
  // Matriz Legal: tipos obrigatórios por função de prestador (junção por presença).
  app.get('/api/admin/document-requirements', authenticate, requireAdmin, async (_req: any, res) => {
    try {
      const { rows: types } = await query(
        'SELECT id, nome, categoria, obrigatorio, escopo, ativo, ordem FROM document_types WHERE ativo = true ORDER BY ordem, nome');
      const { rows: requirements } = await query(
        'SELECT type_id, role FROM document_type_requirements');
      res.json({ types, requirements });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/document-requirements', authenticate, requireAdmin, async (req: any, res) => {
    const { type_id, role, obrigatorio } = req.body;
    if (!Number.isInteger(Number(type_id))) return res.status(400).json({ error: 'type_id inválido' });
    if (!PROVIDER_ACCESS_ROLES.includes(String(role))) return res.status(400).json({ error: 'Função inválida' });
    try {
      if (obrigatorio) {
        await query(
          `INSERT INTO document_type_requirements (type_id, role) VALUES ($1, $2)
           ON CONFLICT (type_id, role) DO NOTHING`,
          [Number(type_id), String(role)]);
      } else {
        await query('DELETE FROM document_type_requirements WHERE type_id = $1 AND role = $2',
          [Number(type_id), String(role)]);
      }
      res.json({ ok: true });
    } catch (err: any) {
      // FK inexistente (type_id não existe) vem como 23503.
      if (err.code === '23503') return res.status(400).json({ error: 'Tipo de documento não encontrado' });
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: Verificar compilação**

Run: `npm run lint`
Expected: `tsc --noEmit` sem erros. Corrigir tipos se acusar.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat(documentos): endpoints admin da Matriz Legal (ler/alternar)"
```

---

### Task 4: UI da grade na aba Matriz Legal

**Files:**
- Create: `src/pages/documentos/MatrizLegal.tsx`
- Modify: `src/pages/documentos/GestaoDocumental.tsx` (importar e renderizar no lugar do stub)

**Interfaces:**
- Consumes: `GET`/`PUT /api/admin/document-requirements` (Task 3) via `fetchApi`.
- Produces: componente default `MatrizLegal` (sem props).

- [ ] **Step 1: Criar o componente**

Create `src/pages/documentos/MatrizLegal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';

type Tipo = { id: number; nome: string; ordem: number };
type Req = { type_id: number; role: string };

const ROLES: [string, string][] = [
  ['cooperado', 'Médico Cooperado'],
  ['credenciado', 'Médico Credenciado'],
  ['pf_nao_medico', 'PF não médico'],
  ['prestador', 'Prestador PJ'],
];
const chave = (typeId: number, role: string) => `${typeId}:${role}`;

export default function MatrizLegal() {
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetchApi('/admin/document-requirements')
      .then((d: { types: Tipo[]; requirements: Req[] }) => {
        setTipos(d.types);
        setMarcados(new Set(d.requirements.map(r => chave(r.type_id, r.role))));
      })
      .catch(e => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  async function alternar(typeId: number, role: string, obrigatorio: boolean) {
    const k = chave(typeId, role);
    // Otimista: atualiza já; reverte se o PUT falhar.
    setMarcados(prev => {
      const n = new Set(prev);
      if (obrigatorio) n.add(k); else n.delete(k);
      return n;
    });
    setErro('');
    try {
      await fetchApi('/admin/document-requirements', {
        method: 'PUT',
        body: JSON.stringify({ type_id: typeId, role, obrigatorio }),
      });
    } catch (e: any) {
      setErro(e.message);
      setMarcados(prev => {
        const n = new Set(prev);
        if (obrigatorio) n.delete(k); else n.add(k);
        return n;
      });
    }
  }

  if (carregando) return <div className="p-8 text-center text-gray-400">Carregando…</div>;
  if (!tipos.length)
    return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">
      Nenhum tipo de documento cadastrado. Cadastre tipos no catálogo primeiro.
    </div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Marque quais documentos são obrigatórios para cada função de prestador.
      </p>
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Documento</th>
              {ROLES.map(([role, label]) => (
                <th key={role} className="px-4 py-3 text-center font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tipos.map(t => (
              <tr key={t.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 text-gray-900">{t.nome}</td>
                {ROLES.map(([role]) => (
                  <td key={role} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-600"
                      aria-label={`${t.nome} obrigatório para ${role}`}
                      checked={marcados.has(chave(t.id, role))}
                      onChange={e => alternar(t.id, role, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar na casca**

Em `src/pages/documentos/GestaoDocumental.tsx`:

Adicionar o import junto aos outros de páginas:
```ts
import MatrizLegal from './MatrizLegal';
```

Trocar a linha do stub:
```tsx
      {aba === 'matriz' && <EmBreve titulo="Matriz Legal" />}
```
por:
```tsx
      {aba === 'matriz' && <MatrizLegal />}
```

- [ ] **Step 3: Verificar compilação e build**

Run: `npm run lint && npm run build`
Expected: `tsc` sem erros; build do cliente ok.

- [ ] **Step 4: Commit**

```bash
git add src/pages/documentos/MatrizLegal.tsx src/pages/documentos/GestaoDocumental.tsx
git commit -m "feat(documentos): grade da Matriz Legal na aba admin"
```

---

## Capstone (após as 4 tasks)

- [ ] `npm test` — toda a suíte verde (inclui `matrizLegal.test.ts`).
- [ ] `npm run lint` — `tsc` limpo.
- [ ] `npm run build` — build ok.
- [ ] Revisão final da branch (requesting-code-review) + correções.
- [ ] Smoke no navegador (admin): aba Matriz Legal mostra tipos × 4 funções; marcar/desmarcar uma célula persiste após reload.
- [ ] Push da `dev` só após o OK da Katy.

## Notas de verificação
- Lógica pura (`obrigatoriosPara`) coberta por teste. Os endpoints espelham exatamente os de `document-types` (validação, guard, tratamento de erro) e são verificados por `tsc` + o smoke do navegador na Task 4/capstone.
- A grade usa save otimista com reversão em erro — o smoke confirma persistência após reload.
