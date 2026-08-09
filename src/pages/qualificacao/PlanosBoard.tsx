import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Search, Plus, ClipboardList, Clock, AlertTriangle, MapPin } from 'lucide-react';
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
    if (!q) return plans;
    return plans.filter((p: any) =>
      (p.provider_name || '').toLowerCase().includes(q) ||
      (p.provider_code || '').toLowerCase().includes(q)
    );
  }, [plans, search]);

  const kpis = useMemo(() => ({
    ativos: plans.filter((p: any) => !FINAL_STATUSES.includes(p.status)).length,
    atrasados: plans.filter((p: any) => p.status === 'atrasado').length,
    aguardandoValidacao: plans.filter((p: any) => p.status === 'aguardando_revisao').length,
  }), [plans]);

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
          {cycles.length > 0 && (
            <select
              className="border rounded-lg px-3 py-2 text-sm bg-white"
              value={cycleId ?? ''}
              onChange={e => setCycleId(Number(e.target.value))}
            >
              {cycles.map(c => (
                <option key={c.id} value={c.id}>{c.label}{c.active ? ' (ativo)' : ''}</option>
              ))}
            </select>
          )}
          <button onClick={openNewModal} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Novo plano avulso
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi icon={<ClipboardList className="w-5 h-5" />} label="Planos ativos" value={kpis.ativos} tone="blue" />
        <Kpi icon={<AlertTriangle className="w-5 h-5" />} label="Atrasados" value={kpis.atrasados} tone={kpis.atrasados > 0 ? 'red' : 'gray'} />
        <Kpi icon={<Clock className="w-5 h-5" />} label="Aguardando validação" value={kpis.aguardandoValidacao} tone="orange" />
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar por prestador ou código..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-gray-50 border-none rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
        />
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
              <button onClick={() => setShowNewModal(false)} className="btn btn-outline">Cancelar</button>
              <button onClick={createPlan} disabled={!newProviderId || saving} className="btn btn-primary disabled:opacity-50">
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

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: 'blue'|'orange'|'red'|'gray' }) {
  const bg = { blue: 'bg-blue-50 text-blue-600', orange: 'bg-orange-50 text-orange-600', red: 'bg-red-50 text-red-600', gray: 'bg-gray-50 text-gray-500' }[tone];
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
