import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Search, Plus, Filter, Calendar, ArrowUpCircle, MapPin } from 'lucide-react';
import { PLAN_STATUS_LABEL, PLAN_COLOR_CLASS } from './planoStatus';
import PlanoDetail from './PlanoDetail';

const FINAL_STATUSES = ['concluido', 'encerrado_sem_conclusao'];

const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'aberto', label: 'Em aberto', statuses: ['aberto', 'em_andamento'] },
  { key: 'aguardando_revisao', label: 'A validar', statuses: ['aguardando_revisao'] },
  { key: 'a_vencer', label: 'A vencer', statuses: ['a_vencer'] },
  { key: 'atrasado', label: 'Atrasado', statuses: ['atrasado'] },
  { key: 'final', label: 'Finalizados', statuses: FINAL_STATUSES },
];

// Tom por coluna: bolinha do cabeçalho, pill de ações do card, borda da coluna e
// fundo claro do corpo (tint a ~5% via alpha /50 do shade -50). Chaveado por COLUMNS.key.
const TONE: Record<string, { dot: string; pill: string; border: string; body: string }> = {
  aberto:             { dot: 'bg-blue-500',    pill: 'bg-blue-50 text-blue-700',       border: 'border-blue-100',    body: 'bg-blue-50/50' },
  aguardando_revisao: { dot: 'bg-orange-500',  pill: 'bg-amber-100 text-amber-800',    border: 'border-amber-100',   body: 'bg-amber-50/50' },
  a_vencer:           { dot: 'bg-amber-500',   pill: 'bg-amber-50 text-amber-700',     border: 'border-amber-100',   body: 'bg-amber-50/40' },
  atrasado:           { dot: 'bg-red-500',     pill: 'bg-red-50 text-red-700',         border: 'border-red-100',     body: 'bg-red-50/50' },
  final:              { dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700', border: 'border-emerald-100', body: 'bg-emerald-50/50' },
};

// Datas `date` chegam como 'YYYY-MM-DD' (db.ts); formata sem passar por Date p/ não deslocar fuso.
const fmtDate = (v?: string | null): string => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  try { return new Date(v).toLocaleDateString('pt-BR'); } catch { return String(v); }
};

export default function PlanosBoard() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [providers, setProviders] = useState<any[]>([]);
  const [newProviderId, setNewProviderId] = useState('');
  const [newLocations, setNewLocations] = useState<any[]>([]);
  const [newLocationId, setNewLocationId] = useState('');
  const [loadingLocs, setLoadingLocs] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { (async () => {
    const cs = await fetchApi('/eval/cycles');
    setCycles(cs);
    const active = cs.find((c: any) => c.active) || cs[0];
    if (active) setCycleId(active.id);
  })(); }, []);

  const loadPlans = async (id: number) => {
    setLoading(true);
    try { setPlans(await fetchApi(`/eval/action-plans?cycle_id=${id}`)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (cycleId == null) return;
    loadPlans(cycleId);
  }, [cycleId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((p: any) => {
      if (q && !((p.provider_name || '').toLowerCase().includes(q) ||
                 (p.provider_code || '').toLowerCase().includes(q))) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      return true;
    });
  }, [plans, search, statusFilter]);

  const providerOptions = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    const list = q
      ? providers.filter((p: any) =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.code || '').toLowerCase().includes(q))
      : providers;
    return list.slice(0, 50); // ponytail: cap render; busca estreita antes de rolar
  }, [providers, providerSearch]);

  const activeFilterCount = statusFilter ? 1 : 0;

  const clearFilters = () => {
    setStatusFilter('');
  };

  const openNewModal = async () => {
    setProviderSearch('');
    setNewProviderId('');
    setNewLocations([]);
    setNewLocationId('');
    setShowNewModal(true);
    if (providers.length === 0) setProviders(await fetchApi('/providers'));
  };

  // Só unidades comerciais (mesma regra do backend: exclui residencial).
  const isCommercialLoc = (l: any) =>
    !/^residencial/i.test(l.label || '') && !/-RES$/.test(l.sgu_location_code || '');
  const locLabel = (l: any) => {
    const uf = l.uf ? '/' + String(l.uf).toUpperCase() : '';
    const city = l.cidade ? `${l.cidade}${uf}` : '';
    const main = l.logradouro || l.label || 'Unidade';
    return city ? `${main} — ${city}` : main;
  };

  // Ao escolher o prestador, carrega as unidades. 1 comercial → pré-seleciona;
  // várias → exige escolher; nenhuma → plano fica sem endereço.
  const selectProvider = async (id: string) => {
    setNewProviderId(id);
    setNewLocationId('');
    setNewLocations([]);
    if (!id) return;
    setLoadingLocs(true);
    try {
      const p = await fetchApi(`/providers/${id}`);
      const locs = (p?.locations ?? []).filter(isCommercialLoc);
      setNewLocations(locs);
      if (locs.length === 1) setNewLocationId(String(locs[0].id));
    } catch { setNewLocations([]); }
    finally { setLoadingLocs(false); }
  };

  const needsLocationChoice = newLocations.length > 1 && !newLocationId;

  const createPlan = async () => {
    if (!newProviderId || cycleId == null || needsLocationChoice) return;
    setSaving(true);
    try {
      await fetchApi('/eval/action-plans', {
        method: 'POST',
        body: JSON.stringify({
          provider_id: Number(newProviderId),
          cycle_id: cycleId,
          ...(newLocationId ? { location_id: Number(newLocationId) } : {}),
        }),
      });
      setShowNewModal(false);
      setNewProviderId('');
      setNewLocations([]);
      setNewLocationId('');
      setProviderSearch('');
      await loadPlans(cycleId);
    } catch (e: any) {
      alert(e?.message || 'Erro ao criar plano');
    } finally {
      setSaving(false);
    }
  };

  if (loading && plans.length === 0) {
    return <div className="p-8 text-center text-gray-500">Carregando planos de ação...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plano de Ação</h1>
          <p className="text-sm text-gray-500">Acompanhamento dos planos de ação dos prestadores</p>
        </div>
        <div className="flex gap-3 items-center">
          <button
            onClick={openNewModal}
            className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            <Plus className="w-5 h-5" /> <span>Novo Plano</span>
          </button>
        </div>
      </div>

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
          aria-expanded={showFilters}
          aria-controls="planos-filtros-panel"
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

      {showFilters && (
        <div id="planos-filtros-panel" className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {COLUMNS.map(col => {
          const colPlans = filtered.filter((p: any) => col.statuses.includes(p.status));
          const tone = TONE[col.key] ?? TONE.aberto;
          return (
            <div key={col.key} className={`flex flex-col overflow-hidden rounded-2xl border ${tone.border} bg-white shadow-sm`}>
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                  <p className="truncate text-sm font-bold text-gray-900">{col.label}</p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 tabular-nums">{colPlans.length}</span>
              </div>
              <div className={`flex-1 border-t ${tone.border} ${tone.body} p-2.5`}>
                <div className="space-y-3">
                  {colPlans.length === 0 ? (
                    <p className="py-6 text-center text-xs text-gray-400">Nenhum plano</p>
                  ) : colPlans.map((p: any) => (
                    <PlanoCard key={p.id} plan={p} colKey={col.key} onOpen={() => setSelectedPlanId(p.id)} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedPlanId != null && (
        <PlanoDetail
          planId={selectedPlanId}
          onClose={() => {
            setSelectedPlanId(null);
            if (cycleId != null) loadPlans(cycleId);
          }}
        />
      )}

      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Novo plano avulso</h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                autoFocus
                placeholder="Buscar por nome ou código..."
                value={providerSearch}
                onChange={e => { setProviderSearch(e.target.value); selectProvider(''); }}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
              {providerOptions.length === 0 ? (
                <p className="p-4 text-center text-sm text-gray-400">Nenhum prestador encontrado.</p>
              ) : providerOptions.map((p: any) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(String(p.id))}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    String(p.id) === newProviderId ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <span className="font-medium">{p.name}</span>
                  {p.code && <span className="ml-2 text-xs text-gray-500">{p.code}</span>}
                </button>
              ))}
            </div>

            {newProviderId && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Unidade / endereço</p>
                {loadingLocs ? (
                  <p className="text-sm text-gray-400">Carregando unidades...</p>
                ) : newLocations.length === 0 ? (
                  <p className="text-sm text-gray-500">Este prestador não tem unidade comercial cadastrada — o plano ficará sem endereço.</p>
                ) : newLocations.length === 1 ? (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                    <MapPin className="h-4 w-4 shrink-0" /> {locLabel(newLocations[0])}
                  </p>
                ) : (
                  <select
                    value={newLocationId}
                    onChange={e => setNewLocationId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione a unidade...</option>
                    {newLocations.map((l: any) => (
                      <option key={l.id} value={l.id}>{locLabel(l)}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowNewModal(false); setProviderSearch(''); selectProvider(''); }} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={createPlan}
                disabled={!newProviderId || saving || needsLocationChoice}
                className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#007A4A] transition-colors disabled:opacity-50"
              >
                {saving ? 'Criando...' : 'Criar plano'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanoCard({ plan, colKey, onOpen }: any) {
  const items = plan.items || [];
  const open = items.filter((i: any) => i.status !== 'concluida');
  const toValidate = items.filter((i: any) => i.status === 'aguardando_revisao');
  const tone = TONE[colKey] ?? TONE.aberto;
  const nearestDue = open.map((i: any) => i.due_date).filter(Boolean).sort()[0] as string | undefined;

  const plural = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;
  const pillText =
    colKey === 'aberto'             ? plural(open.length, 'ação aberta', 'ações abertas') :
    colKey === 'aguardando_revisao' ? plural(toValidate.length || open.length, 'ação para validar', 'ações para validar') :
    colKey === 'a_vencer'           ? `${open.length} a vencer` :
    colKey === 'atrasado'           ? plural(open.length, 'ação atrasada', 'ações atrasadas') :
    plan.status === 'concluido'     ? 'Concluído' : 'Encerrado sem conclusão';

  // Linha de contexto (ícone + data/estado), com cor por urgência.
  let MetaIcon: any = Calendar;
  let metaText = '';
  let metaCls = 'text-gray-500';
  if (colKey === 'aguardando_revisao') { MetaIcon = ArrowUpCircle; metaText = 'Evidências aguardando validação'; metaCls = 'text-orange-600'; }
  else if (colKey === 'atrasado' && nearestDue) { metaText = `Venceu em ${fmtDate(nearestDue)}`; metaCls = 'text-red-600'; }
  else if (colKey === 'a_vencer' && nearestDue) { metaText = `Vence em ${fmtDate(nearestDue)}`; metaCls = 'text-amber-600'; }
  else if (colKey === 'aberto' && nearestDue) { metaText = `Próximo prazo: ${fmtDate(nearestDue)}`; }

  const isValidate = colKey === 'aguardando_revisao';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-xl border border-gray-200 bg-white p-3.5 text-left shadow-sm transition hover:border-gray-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <p className="text-sm font-bold leading-tight text-gray-900">{plan.provider_name}</p>
      <p className="mt-0.5 text-xs text-gray-500">Cod: {plan.provider_code || '—'}</p>
      {(plan.location_label || plan.city) && (
        <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-emerald-700">
          <MapPin className="h-3 w-3 shrink-0" /> {plan.location_label || plan.city}{plan.location_uf ? '/' + String(plan.location_uf).toUpperCase() : ''}
        </p>
      )}

      <span className={`mt-2.5 inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${tone.pill}`}>
        {pillText}
      </span>

      {metaText && (
        <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${metaCls}`}>
          <MetaIcon className="h-3.5 w-3.5 shrink-0" /> {metaText}
        </p>
      )}

      <div className="mt-3 flex flex-col items-center gap-2 border-t border-gray-100 pt-2.5">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${PLAN_COLOR_CLASS[plan.color] || 'bg-gray-100 text-gray-600'}`}>
          {PLAN_STATUS_LABEL[plan.status] || plan.status}
        </span>
        <span className={isValidate
          ? 'inline-flex items-center rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white'
          : 'text-xs font-semibold text-emerald-700'}
        >
          {isValidate ? 'Validar agora' : 'Ver plano'}
        </span>
      </div>
    </button>
  );
}
