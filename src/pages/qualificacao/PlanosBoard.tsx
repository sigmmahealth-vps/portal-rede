import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Search, Plus, ClipboardList, Clock, AlertTriangle, MapPin, Filter, X, CalendarClock, CheckCircle2 } from 'lucide-react';
import { PLAN_STATUS_LABEL, PLAN_COLOR_CLASS } from './planoStatus';
import PlanoDetail from './PlanoDetail';

const FINAL_STATUSES = ['concluido', 'encerrado_sem_conclusao'];

const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'aberto', label: 'Em aberto', statuses: ['aberto', 'em_andamento'] },
  { key: 'aguardando_revisao', label: 'Aguardando validação', statuses: ['aguardando_revisao'] },
  { key: 'a_vencer', label: 'A vencer', statuses: ['a_vencer'] },
  { key: 'atrasado', label: 'Atrasado', statuses: ['atrasado'] },
  { key: 'final', label: 'Finalizados', statuses: FINAL_STATUSES },
];

// Cards de status: mesmo esquema de cores dos status de plano (planoStatus.ts).
const CARD_TONE: Record<string, 'blue' | 'orange' | 'amber' | 'red' | 'emerald'> = {
  aberto: 'blue', aguardando_revisao: 'orange', a_vencer: 'amber', atrasado: 'red', final: 'emerald',
};
const CARD_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  aberto: ClipboardList, aguardando_revisao: Clock, a_vencer: CalendarClock,
  atrasado: AlertTriangle, final: CheckCircle2,
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
  const [saving, setSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState<{ id: number; label: string } | null>(null);
  const [providerQuery, setProviderQuery] = useState('');

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
  };

  const openNewModal = async () => {
    setShowNewModal(true);
    if (providers.length === 0) setProviders(await fetchApi('/providers'));
  };

  const createPlan = async () => {
    if (!newProviderId || cycleId == null) return;
    setSaving(true);
    try {
      await fetchApi('/eval/action-plans', {
        method: 'POST',
        body: JSON.stringify({ provider_id: Number(newProviderId), cycle_id: cycleId }),
      });
      setShowNewModal(false);
      setNewProviderId('');
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

            <label className="relative block text-sm">
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
            </label>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {COLUMNS.map(col => {
          const Icon = CARD_ICON[col.key];
          const n = filtered.filter((p: any) => col.statuses.includes(p.status)).length;
          return <Kpi key={col.key} icon={<Icon className="w-5 h-5" />} label={col.label} value={n} tone={CARD_TONE[col.key]} />;
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {COLUMNS.map(col => {
          const colPlans = filtered.filter((p: any) => col.statuses.includes(p.status));
          return (
            <div key={col.key} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3 flex items-center justify-between">
                {col.label} <span className="text-gray-400">{colPlans.length}</span>
              </p>
              <div className="space-y-3">
                {colPlans.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Nenhum plano</p>
                ) : colPlans.map((p: any) => (
                  <PlanoCard key={p.id} plan={p} onOpen={() => setSelectedPlanId(p.id)} />
                ))}
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
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
              value={newProviderId}
              onChange={e => setNewProviderId(e.target.value)}
            >
              <option value="">Selecione o prestador...</option>
              {providers.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} ({p.cnpj})</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewModal(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={createPlan}
                disabled={!newProviderId || saving}
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

function PlanoCard({ plan, onOpen }: any) {
  const openItems = (plan.items || []).filter((it: any) => it.status !== 'concluida').length;
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-3 space-y-2">
      <div>
        <p className="font-medium text-gray-900 text-sm leading-tight">{plan.provider_name}</p>
        <p className="text-xs text-gray-500">{plan.provider_code || '—'}</p>
        {plan.city && (
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {plan.city}</p>
        )}
      </div>
      <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded-full tracking-wide ${PLAN_COLOR_CLASS[plan.color] || 'bg-gray-100 text-gray-600'}`}>
        {PLAN_STATUS_LABEL[plan.status] || plan.status}
      </span>
      <p className="text-xs text-gray-500">{openItems} item{openItems === 1 ? '' : 's'} em aberto</p>
      <button onClick={onOpen} className="w-full px-2 py-1 text-xs rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
        Ver plano
      </button>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { key?: React.Key; icon: React.ReactNode; label: string; value: React.ReactNode; tone: 'blue'|'orange'|'amber'|'red'|'emerald'|'gray' }) {
  const bg = {
    blue: 'bg-blue-50 text-blue-600', orange: 'bg-orange-50 text-orange-600',
    amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600', gray: 'bg-gray-50 text-gray-500',
  }[tone];
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bg}`}>{icon}</div>
        <div>
          <p className="text-xs text-gray-500 font-medium">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
