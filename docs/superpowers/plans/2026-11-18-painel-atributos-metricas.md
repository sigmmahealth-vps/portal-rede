# Painel: métricas de Certificações e Escolaridade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preencher as sub-abas "Certificações e Dados Técnicos" e "Escolaridade" do Painel de Controle com cards, gráficos e conformidade, a partir dos dados reais de certificações e escolaridade.

**Architecture:** Um endpoint admin agregado devolve as linhas de certificações e escolaridade com a audiência; funções puras (certificações reusam `painelMetrics`; escolaridade ganha `atributosMetrics`) agregam no cliente; dois sub-componentes no `PainelControle` renderizam as abas, reusando `StatCard`/`Card`/`Donut`.

**Tech Stack:** TypeScript (ESM `.js` imports), Postgres (`pg`), Express, React + recharts + `fetchApi`, `node:test`. Sem libs novas.

## Global Constraints

- Imports relativos entre módulos TS usam sufixo `.js` (ESM/tsx).
- Certificações têm `status` (`pendente`/`valido`/`reprovado`) + `expiry_date` → reusam `contarSituacoes` e `conformidade` de `src/lib/painelMetrics.ts` (o balde `vencendo` é o "a vencer").
- Escolaridade usa funções novas em `src/lib/atributosMetrics.ts`.
- Endpoint admin: `authenticate, requireAdmin`. `PainelControle` só renderiza para admin.
- Recorte por audiência via `providerAudience(person_type, provider_group)` (como o resto do Painel).
- Níveis (ordem canônica): `ensino_medio, tecnico, graduacao, especializacao, residencia, mestrado, doutorado, pos_doutorado`.
- Testes `node:test`; arquivo novo entra no script `"test"` do `package.json`.
- Reusar os componentes já definidos em `PainelControle.tsx`: `StatCard`, `Card`, `Donut` (exportado), `EmBreve`.

---

### Task 1: Funções puras de escolaridade

**Files:**
- Create: `src/lib/atributosMetrics.ts`
- Test: `src/lib/atributosMetrics.test.ts`
- Modify: `package.json` (registrar o teste)

**Interfaces:**
- Produces:
  - `contarStatus(itens: { status: string }[]): { pendente: number; valido: number; reprovado: number; total: number }`
  - `conformidadeStatus(itens: { status: string }[]): number`
  - `distribuicaoPorNivel(education: { nivel: string }[]): { nivel: string; n: number }[]`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/atributosMetrics.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarStatus, conformidadeStatus, distribuicaoPorNivel } from './atributosMetrics.js';

test('contarStatus: conta por status e ignora desconhecidos', () => {
  const r = contarStatus([{ status: 'pendente' }, { status: 'valido' }, { status: 'valido' }, { status: 'reprovado' }, { status: 'outro' }]);
  assert.deepEqual(r, { pendente: 1, valido: 2, reprovado: 1, total: 4 });
});

test('contarStatus: lista vazia', () => {
  assert.deepEqual(contarStatus([]), { pendente: 0, valido: 0, reprovado: 0, total: 0 });
});

test('conformidadeStatus: valido / (valido+reprovado), pendentes fora', () => {
  assert.equal(conformidadeStatus([{ status: 'valido' }, { status: 'valido' }, { status: 'reprovado' }, { status: 'pendente' }]), 67);
});

test('conformidadeStatus: sem válidos/reprovados → 0', () => {
  assert.equal(conformidadeStatus([{ status: 'pendente' }]), 0);
  assert.equal(conformidadeStatus([]), 0);
});

test('distribuicaoPorNivel: ordem canônica, só n>0, ignora nível desconhecido', () => {
  const r = distribuicaoPorNivel([
    { nivel: 'mestrado' }, { nivel: 'graduacao' }, { nivel: 'graduacao' }, { nivel: 'xpto' },
  ]);
  assert.deepEqual(r, [{ nivel: 'graduacao', n: 2 }, { nivel: 'mestrado', n: 1 }]);
});

test('distribuicaoPorNivel: vazio', () => {
  assert.deepEqual(distribuicaoPorNivel([]), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/atributosMetrics.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

Create `src/lib/atributosMetrics.ts`:

```ts
// Métricas de atributos autoinformados (Certificações usam painelMetrics; aqui fica a Escolaridade).
// Puro e testável; o Painel agrega no cliente.

export function contarStatus(itens: { status: string }[]): { pendente: number; valido: number; reprovado: number; total: number } {
  const c = { pendente: 0, valido: 0, reprovado: 0, total: 0 };
  for (const it of itens) {
    if (it.status === 'pendente') c.pendente++;
    else if (it.status === 'valido') c.valido++;
    else if (it.status === 'reprovado') c.reprovado++;
    else continue; // status desconhecido não entra na contagem
    c.total++;
  }
  return c;
}

export function conformidadeStatus(itens: { status: string }[]): number {
  const c = contarStatus(itens);
  const base = c.valido + c.reprovado; // pendentes ficam de fora (ainda não analisados)
  return base === 0 ? 0 : Math.round((c.valido / base) * 100);
}

const NIVEIS_ORDEM = ['ensino_medio', 'tecnico', 'graduacao', 'especializacao', 'residencia', 'mestrado', 'doutorado', 'pos_doutorado'];

export function distribuicaoPorNivel(education: { nivel: string }[]): { nivel: string; n: number }[] {
  const cont = new Map<string, number>();
  for (const e of education) cont.set(e.nivel, (cont.get(e.nivel) ?? 0) + 1);
  return NIVEIS_ORDEM.filter(n => (cont.get(n) ?? 0) > 0).map(n => ({ nivel: n, n: cont.get(n)! }));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test src/lib/atributosMetrics.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Registrar o teste no script `test`**

Em `package.json`, no fim do valor do script `"test"` (antes da aspa final), acrescentar:
` src/lib/atributosMetrics.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/atributosMetrics.ts src/lib/atributosMetrics.test.ts package.json
git commit -m "feat(painel): metricas de escolaridade (contarStatus, conformidadeStatus, distribuicaoPorNivel)"
```

---

### Task 2: Endpoint admin agregado

**Files:**
- Modify: `server.ts` (inserir a rota após `GET /api/admin/document-verificar`)

**Interfaces:**
- Consumes: `authenticate`, `requireAdmin`, `query` (em escopo).
- Produces: `GET /api/admin/atributos-metrics` → `{ certifications: {status, expiry_date, person_type, provider_group}[], education: {status, nivel, person_type, provider_group}[] }`.

- [ ] **Step 1: Inserir a rota**

Logo após o fechamento da rota `app.get('/api/admin/document-verificar', ...)` (termina com `});`), inserir:

```ts
  // Métricas agregadas de atributos (Certificações + Escolaridade) para o Painel de Controle.
  app.get('/api/admin/atributos-metrics', authenticate, requireAdmin, async (_req: any, res) => {
    try {
      const { rows: certifications } = await query(
        `SELECT c.status, c.expiry_date, p.person_type, p.provider_group
           FROM provider_certifications c JOIN providers p ON p.id = c.provider_id`);
      const { rows: education } = await query(
        `SELECT e.status, e.nivel, p.person_type, p.provider_group
           FROM provider_education e JOIN providers p ON p.id = e.provider_id`);
      res.json({ certifications, education });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: Verificar compilação**

Run: `npm run lint`
Expected: `tsc --noEmit` sem erros.

- [ ] **Step 3: Sanidade no DEV (read-only)**

```bash
APP_ENV=dev node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const {rows:c}=await query('SELECT count(*)::int n FROM provider_certifications');const {rows:e}=await query('SELECT count(*)::int n FROM provider_education');console.log('certificações:',c[0].n,'| escolaridade:',e[0].n);await pool.end();})"
```

Expected: imprime as contagens (podem ser 0 — o Painel mostra "sem dados").

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(painel): endpoint admin atributos-metrics"
```

---

### Task 3: Sub-abas de métricas no `PainelControle`

**Files:**
- Modify: `src/pages/documentos/PainelControle.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/atributos-metrics`; `contarSituacoes`/`conformidade` (painelMetrics, já importados); `contarStatus`/`conformidadeStatus`/`distribuicaoPorNivel` (atributosMetrics, Task 1); `providerAudience` (já importado); `StatCard`/`Card`/`Donut`/`EmBreve` (no arquivo).
- Produces: sub-componentes `CertMetrics` e `EscolMetrics` + o estado/fetch que os alimenta.

- [ ] **Step 1: Importar as funções novas**

No topo de `PainelControle.tsx`, junto do import de `painelMetrics`, adicionar:
```ts
import { contarStatus, conformidadeStatus, distribuicaoPorNivel } from '../../lib/atributosMetrics.js';
```

E uma constante de rótulos de nível, perto do `const ALVARAS = [...]`:
```ts
const NIVEL_LABEL: Record<string, string> = {
  ensino_medio: 'Ensino Médio', tecnico: 'Técnico', graduacao: 'Graduação',
  especializacao: 'Especialização', residencia: 'Residência', mestrado: 'Mestrado',
  doutorado: 'Doutorado', pos_doutorado: 'Pós-Doutorado',
};
```

- [ ] **Step 2: Buscar o endpoint e filtrar por audiência**

Dentro de `PainelControle`, após o `useEffect` que busca `/documents`, adicionar o estado e o fetch,
e os memos filtrados por audiência (perto do `const base = useMemo(...)`):

```ts
  const [atrib, setAtrib] = useState<{ certifications: any[]; education: any[] }>({ certifications: [], education: [] });
  useEffect(() => { fetchApi('/admin/atributos-metrics').then(setAtrib).catch(() => {}); }, []);

  const certs = useMemo(() => atrib.certifications.filter(x => providerAudience(x.person_type ?? null, x.provider_group ?? null) === audiencia), [atrib, audiencia]);
  const edu = useMemo(() => atrib.education.filter(x => providerAudience(x.person_type ?? null, x.provider_group ?? null) === audiencia), [atrib, audiencia]);
```

- [ ] **Step 3: Trocar os stubs das abas `cert` e `escol`**

Substituir:
```tsx
      {sub === 'cert' && <EmBreve titulo="Certificações e Dados Técnicos" />}
      {sub === 'escol' && <EmBreve titulo="Escolaridade" />}
```
por:
```tsx
      {sub === 'cert' && <CertMetrics certs={certs} hoje={hoje} />}
      {sub === 'escol' && <EscolMetrics edu={edu} />}
```

- [ ] **Step 4: Adicionar os sub-componentes**

No fim do arquivo (junto dos outros sub-componentes como `Overview`/`Alvaras`), adicionar:

```tsx
function CertMetrics({ certs, hoje }: { certs: any[]; hoje: Date }) {
  const c = contarSituacoes(certs, hoje);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Regulares" valor={c.regular} cor="text-emerald-700" bg="bg-emerald-50" />
        <StatCard label="Vencendo" valor={c.vencendo} cor="text-amber-700" bg="bg-amber-50" />
        <StatCard label="Irregulares" valor={c.irregular} cor="text-red-700" bg="bg-red-50" />
        <StatCard label="Pendentes" valor={c.pendente} cor="text-blue-700" bg="bg-blue-50" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card titulo="Taxa de Conformidade (certificações)"><Donut pct={conformidade(certs, hoje)} /></Card>
        <EmBreve titulo="Dados Técnicos (CNES, ISS, Prontuário)" />
      </div>
    </div>
  );
}

function EscolMetrics({ edu }: { edu: any[] }) {
  const c = contarStatus(edu);
  const dist = distribuicaoPorNivel(edu).map(d => ({ nome: NIVEL_LABEL[d.nivel] ?? d.nivel, valor: d.n }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pendentes" valor={c.pendente} cor="text-blue-700" bg="bg-blue-50" />
        <StatCard label="Válidas" valor={c.valido} cor="text-emerald-700" bg="bg-emerald-50" />
        <StatCard label="Reprovadas" valor={c.reprovado} cor="text-red-700" bg="bg-red-50" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card titulo="Distribuição por nível">
          {dist.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dist}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="nome" /><YAxis allowDecimals={false} /><Tooltip />
                <Bar dataKey="valor" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-10 text-center text-sm text-gray-400">Sem formações cadastradas.</p>}
        </Card>
        <Card titulo="Taxa de Conformidade (escolaridade)"><Donut pct={conformidadeStatus(edu)} /></Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verificar compilação e build**

Run: `npm run lint && npm run build`
Expected: `tsc` sem erros; build ok.

- [ ] **Step 6: Commit**

```bash
git add src/pages/documentos/PainelControle.tsx
git commit -m "feat(painel): abas de metricas de Certificacoes e Escolaridade"
```

---

## Capstone (após as 3 tasks)

- [ ] `npm test` — suíte verde (inclui `atributosMetrics.test.ts`).
- [ ] `npm run lint` — `tsc` limpo.
- [ ] `npm run build` — build ok.
- [ ] Revisão final da branch (requesting-code-review) + correções.
- [ ] **Reiniciar o servidor dev** (endpoint novo).
- [ ] Smoke no navegador (admin): Gestão Documental → Painel de Controle → abas "Certificações e Dados Técnicos" e "Escolaridade" mostram cards/gráficos; o toggle Médicos/Rede recorta; "Dados Técnicos — em breve" aparece na primeira.
- [ ] Push da `dev` só após o OK da Katy.

## Notas de verificação
- Lógica pura de escolaridade coberta por teste; certificações reusam `painelMetrics` (já testado).
- Endpoint verificado por `tsc` + sanidade DEV + smoke; componentes por `tsc` + build + smoke.
- Se o DEV tiver poucos dados, os gráficos aparecem com o que houver (ou "sem dados"); dá pra semear via as telas do prestador.
