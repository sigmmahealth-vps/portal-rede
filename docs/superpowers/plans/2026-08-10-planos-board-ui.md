# Melhorias de UI do Plano de Ação (staff) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar a tela "Plano de Ação" do staff ao visual do portal: abas pill com ícones, botão "+ Novo Plano" padrão, painel "Filtros" recolhível (Ciclo/Status/Prestador por nome ou código) e 5 cards de status.

**Architecture:** Só frontend, 2 arquivos: `QualificacaoStaff.tsx` (bandeja de abas) e `PlanosBoard.tsx` (botão, filtros client-side, cards). Nenhuma mudança de API/banco — filtros operam sobre o payload já carregado de `GET /eval/action-plans?cycle_id=` (que inclui `provider_id`, `provider_name`, `provider_code`, `status`, `color`).

**Tech Stack:** React 19, Tailwind 4, lucide-react (sem libs novas).

**Spec:** `docs/superpowers/specs/2026-08-10-planos-board-ui-design.md`

**Convenções (todas as tasks):**
- Working dir: `portal-rede-v1-main/` (paths relativos a ela).
- Verificação por task: `npx tsc --noEmit && npm run build` (sem testes novos — mudança 100% de UI; o projeto não tem testes de componente).
- Commits: `<type>: <descrição>`, SEM Co-Authored-By.
- NÃO iniciar dev server; smoke manual fica com o usuário ao final.

---

### Task 1: Abas pill com ícones (`QualificacaoStaff.tsx`)

**Files:**
- Modify: `src/pages/qualificacao/QualificacaoStaff.tsx` (arquivo tem 58 linhas; ler antes)

- [ ] **Step 1: Adicionar import do lucide e o campo `icon` nas TABS**

No topo (após o import do React), adicionar:

```tsx
import { TrendingUp, LayoutGrid, CalendarRange, Target } from 'lucide-react';
```

Substituir a declaração de `TABS` (linhas 9-14) por:

```tsx
const TABS: { slug: TabSlug; label: string; icon: React.ComponentType<{ className?: string }>; Comp: React.ComponentType<{ user: any }> }[] = [
  { slug: 'estrategico',  label: 'Estratégico',     icon: TrendingUp,    Comp: GestorDashboard },
  { slug: 'painel-ciclo', label: 'Painel do Ciclo', icon: LayoutGrid,    Comp: PainelDoCiclo },
  { slug: 'ciclos',       label: 'Ciclos',          icon: CalendarRange, Comp: CiclosAdmin },
  { slug: 'planos',       label: 'Plano de Ação',   icon: Target,        Comp: PlanosBoard },
];
```

- [ ] **Step 2: Trocar a barra sublinhada pela bandeja pill (padrão PrestadorView.tsx:315-330)**

Substituir o bloco da barra (linhas 38-54, o `<div className="border-b ...">` inteiro com o `<nav>`) por:

```tsx
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
        {TABS.map(t => {
          const active = tab === t.slug;
          return (
            <button
              key={t.slug}
              onClick={() => setTab(t.slug)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                active ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>
```

Nada mais muda: estado `tab`, sincronização `?aba=` (useEffect) e `defaultTabFor` ficam como estão.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros (warning pré-existente de chunk >500kB é normal).

- [ ] **Step 4: Commit**

```bash
git add src/pages/qualificacao/QualificacaoStaff.tsx
git commit -m "feat(planos): abas do staff em estilo pill com icones"
```

---

### Task 2: Botão "+ Novo Plano" e botões do modal (`PlanosBoard.tsx`)

Contexto: as classes `btn btn-primary`/`btn-outline` NÃO existem no CSS (Tailwind 4 sem config custom) — os botões renderizam sem estilo. Padrão da casa: `CiclosAdmin.tsx:60-66`.

**Files:**
- Modify: `src/pages/qualificacao/PlanosBoard.tsx` (ler antes; linhas citadas são do estado atual)

- [ ] **Step 1: Botão principal (linhas 108-110)**

De:
```tsx
          <button onClick={openNewModal} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Novo plano avulso
          </button>
```
Para:
```tsx
          <button
            onClick={openNewModal}
            className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            <Plus className="w-5 h-5" /> <span>Novo Plano</span>
          </button>
```

- [ ] **Step 2: Botões do modal (linhas 176-179)**

De:
```tsx
              <button onClick={() => setShowNewModal(false)} className="btn btn-outline">Cancelar</button>
              <button onClick={createPlan} disabled={!newProviderId || saving} className="btn btn-primary disabled:opacity-50">
                {saving ? 'Criando...' : 'Criar plano'}
              </button>
```
Para:
```tsx
              <button onClick={() => setShowNewModal(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={createPlan}
                disabled={!newProviderId || saving}
                className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#007A4A] transition-colors disabled:opacity-50"
              >
                {saving ? 'Criando...' : 'Criar plano'}
              </button>
```

(O título do modal continua "Novo plano avulso" — descreve a origem manual do plano.)

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/pages/qualificacao/PlanosBoard.tsx
git commit -m "fix(planos): botao Novo Plano e modal no padrao visual do portal"
```

---

### Task 3: Painel "Filtros" (`PlanosBoard.tsx`)

**Files:**
- Modify: `src/pages/qualificacao/PlanosBoard.tsx`

- [ ] **Step 1: Imports e estados novos**

Na linha 3, acrescentar `Filter` e `X` ao import do lucide:
```tsx
import { Search, Plus, ClipboardList, Clock, AlertTriangle, MapPin, Filter, X } from 'lucide-react';
```

Junto aos estados existentes (após `const [saving, setSaving] = useState(false);`), adicionar:
```tsx
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState<{ id: number; label: string } | null>(null);
  const [providerQuery, setProviderQuery] = useState('');
```

- [ ] **Step 2: Derivados de filtro**

Substituir o `useMemo` de `filtered` (linhas 47-54) por:

```tsx
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((p: any) => {
      if (q && !((p.provider_name || '').toLowerCase().includes(q) ||
                 (p.provider_code || '').toLowerCase().includes(q))) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (providerFilter && Number(p.provider_id) !== providerFilter.id) return false;
      return true;
    });
  }, [plans, search, statusFilter, providerFilter]);

  // Prestadores presentes nos planos do ciclo (dedup por id) — sem fetch extra.
  const providerOptions = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; code: string }>();
    for (const p of plans) {
      const id = Number(p.provider_id);
      if (!Number.isNaN(id) && !seen.has(id)) {
        seen.set(id, { id, name: p.provider_name || '', code: p.provider_code || '' });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [plans]);

  const providerSuggestions = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return providerOptions;
    return providerOptions.filter(p =>
      p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  }, [providerOptions, providerQuery]);

  const activeFilterCount = (statusFilter ? 1 : 0) + (providerFilter ? 1 : 0);

  const clearFilters = () => {
    setStatusFilter('');
    setProviderFilter(null);
    setProviderQuery('');
    const active = cycles.find((c: any) => c.active) || cycles[0];
    if (active) setCycleId(active.id);
  };
```

- [ ] **Step 3: Tirar o select de ciclo do cabeçalho**

No cabeçalho (linhas 96-111), remover o bloco `{cycles.length > 0 && (<select ...>)}` inteiro, deixando só o botão "Novo Plano" dentro do `<div className="flex gap-3 items-center">`.

- [ ] **Step 4: Linha de controles (busca + botão Filtros + Limpar)**

Substituir o bloco da busca (linhas 120-129, o `<div className="relative max-w-md">`) por:

```tsx
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por prestador ou código..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border-none rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          onClick={() => setShowFilters(v => !v)}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            showFilters || activeFilterCount > 0
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filtros{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="text-sm font-medium text-gray-500 hover:text-gray-700">
            Limpar
          </button>
        )}
      </div>
```

- [ ] **Step 5: Painel de filtros**

Logo APÓS o fechamento da linha de controles do Step 4 (mesmo nível), inserir:

```tsx
      {showFilters && (
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Ciclo</span>
              <select
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                value={cycleId ?? ''}
                onChange={e => setCycleId(Number(e.target.value))}
              >
                {cycles.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.label}{c.active ? ' (ativo)' : ''}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Status</span>
              <select
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(PLAN_STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <div className="relative text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Prestador</span>
              {providerFilter ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <span className="truncate text-sm font-medium text-emerald-800">{providerFilter.label}</span>
                  <button
                    onClick={() => { setProviderFilter(null); setProviderQuery(''); }}
                    className="ml-2 text-emerald-700 hover:text-emerald-900"
                    aria-label="Limpar prestador"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Nome ou código..."
                    value={providerQuery}
                    onChange={e => setProviderQuery(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                  {providerQuery.trim() !== '' && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                      {providerSuggestions.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400">Nenhum prestador encontrado</p>
                      ) : providerSuggestions.map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setProviderFilter({ id: p.id, label: `${p.name}${p.code ? ` (${p.code})` : ''}` });
                            setProviderQuery('');
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <span className="font-medium text-gray-900">{p.name}</span>
                          {p.code && <span className="ml-1 text-xs text-gray-500">({p.code})</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/pages/qualificacao/PlanosBoard.tsx
git commit -m "feat(planos): painel Filtros com ciclo, status e prestador por nome ou codigo"
```

---

### Task 4: 5 cards de status (`PlanosBoard.tsx`)

**Files:**
- Modify: `src/pages/qualificacao/PlanosBoard.tsx`

- [ ] **Step 1: Imports de ícones**

Acrescentar `CalendarClock` e `CheckCircle2` ao import do lucide (linha 3, já com `Filter, X` da Task 3):
```tsx
import { Search, Plus, ClipboardList, Clock, AlertTriangle, MapPin, Filter, X, CalendarClock, CheckCircle2 } from 'lucide-react';
```

- [ ] **Step 2: Tons e ícones por coluna**

Logo após a declaração de `COLUMNS` (linha 15), adicionar:

```tsx
// Cards de status: mesmo esquema de cores dos status de plano (planoStatus.ts).
const CARD_TONE: Record<string, 'blue' | 'orange' | 'amber' | 'red' | 'emerald'> = {
  aberto: 'blue', aguardando_revisao: 'orange', a_vencer: 'amber', atrasado: 'red', final: 'emerald',
};
const CARD_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  aberto: ClipboardList, aguardando_revisao: Clock, a_vencer: CalendarClock,
  atrasado: AlertTriangle, final: CheckCircle2,
};
```

- [ ] **Step 3: Remover o `useMemo` de `kpis`**

Apagar o bloco `const kpis = useMemo(...)` (linhas 56-60 do estado original — contagens ativos/atrasados/aguardandoValidacao). As contagens novas saem de `filtered` direto no JSX.

- [ ] **Step 4: Substituir a grade de 3 KPIs pelos 5 cards (e mover para depois dos filtros)**

Remover o bloco (linhas 114-118 do estado original):
```tsx
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi icon={<ClipboardList className="w-5 h-5" />} label="Planos ativos" value={kpis.ativos} tone="blue" />
        <Kpi icon={<AlertTriangle className="w-5 h-5" />} label="Atrasados" value={kpis.atrasados} tone={kpis.atrasados > 0 ? 'red' : 'gray'} />
        <Kpi icon={<Clock className="w-5 h-5" />} label="Aguardando validação" value={kpis.aguardandoValidacao} tone="orange" />
      </div>
```
e inserir a grade nova ENTRE o painel de filtros (Task 3 Step 5) e o kanban:
```tsx
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {COLUMNS.map(col => {
          const Icon = CARD_ICON[col.key];
          const n = filtered.filter((p: any) => col.statuses.includes(p.status)).length;
          return <Kpi key={col.key} icon={<Icon className="w-5 h-5" />} label={col.label} value={n} tone={CARD_TONE[col.key]} />;
        })}
      </div>
```
(Contagens sobre `filtered` — coerentes com o board abaixo, como definido no spec.)

- [ ] **Step 5: Estender os tons do `Kpi` local**

Substituir a assinatura e o mapa de tons do componente `Kpi` (linhas 210-211 do estado original):
```tsx
function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: 'blue'|'orange'|'red'|'gray' }) {
  const bg = { blue: 'bg-blue-50 text-blue-600', orange: 'bg-orange-50 text-orange-600', red: 'bg-red-50 text-red-600', gray: 'bg-gray-50 text-gray-500' }[tone];
```
por:
```tsx
function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: 'blue'|'orange'|'amber'|'red'|'emerald'|'gray' }) {
  const bg = {
    blue: 'bg-blue-50 text-blue-600', orange: 'bg-orange-50 text-orange-600',
    amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600', gray: 'bg-gray-50 text-gray-500',
  }[tone];
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/pages/qualificacao/PlanosBoard.tsx
git commit -m "feat(planos): 5 cards de status espelhando as colunas do kanban"
```

---

### Task 5: Verificação final

- [ ] **Step 1: Suíte + typecheck + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 120 testes verdes (nenhum novo), sem erros de tipo, build ok.

- [ ] **Step 2: Smoke manual (com o usuário)**

1. Login staff → Qualificação: abas em pills com ícones, ativa verde.
2. Aba Plano de Ação: botão "+ Novo Plano" verde padrão; modal com Cancelar/Criar estilizados.
3. Botão "Filtros" expande painel; filtrar por status e por prestador digitando nome e depois código; contador "Filtros · N" e "Limpar" funcionam; select de ciclo dentro do painel troca o ciclo.
4. 5 cards com contagens corretas e cores (azul/laranja/âmbar/vermelho/verde), refletindo os filtros.

- [ ] **Step 3: Não pushar ainda**

Commits ficam locais na `dev`; push é decisão do usuário após o smoke.

---

## Self-review (feito na escrita do plano)

- **Spec coverage:** abas (T1), botão + modal (T2), painel Filtros com 3 campos + contador + Limpar (T3), 5 cards informativos com cores (T4), verificação (T5). Fora de escopo respeitado (sem cores de item, sem filtro server-side, sem unificar Kpi).
- **Placeholder scan:** todos os steps têm código completo; sem TBD.
- **Type consistency:** `providerFilter: { id: number; label: string } | null` usado igual em T3 Steps 1/2/5; tons `amber`/`emerald` adicionados ao `Kpi` em T4 Step 5 na mesma task em que são usados (Step 4); `CARD_TONE`/`CARD_ICON` chaveados pelos `key` reais de `COLUMNS` (aberto, aguardando_revisao, a_vencer, atrasado, final).
- **Nota de ordem:** T4 Step 4 posiciona a grade de cards entre o painel de filtros e o kanban (visual); a dependência de `filtered` é calculada nos hooks, antes do JSX, então a ordem dos blocos JSX é livre.
