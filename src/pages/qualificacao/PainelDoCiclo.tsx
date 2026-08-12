import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Search, Download, Eye, Undo2, Award, Shield, Users, ClipboardList, Clock, TrendingUp, AlertTriangle, Building2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import AuditorPlayer from './AuditorPlayer';
import { statusLabel } from '../../lib/statusLabels';

const SEAL_COLORS: Record<string, string> = {
  'Ouro': '#FCD34D', 'Prata': '#9CA3AF', 'Bronze': '#B45309', 'Não Qualificado': '#EF4444',
};

function statusPill(status: string) {
  const map: Record<string, string> = {
    em_andamento: 'bg-blue-100 text-blue-700',
    pendente: 'bg-amber-100 text-amber-800',
    em_analise: 'bg-purple-100 text-purple-800',
    aguardando_evidencia: 'bg-orange-100 text-orange-800',
    aprovado: 'bg-emerald-100 text-emerald-800',
    reprovado: 'bg-red-100 text-red-700',
    finalizado: 'bg-emerald-100 text-emerald-800',
    ciclo_encerrado: 'bg-slate-200 text-slate-700',
  };
  return map[status] || 'bg-gray-100 text-gray-600';
}

export default function PainelDoCiclo({ user }: { user: any }) {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lowSecOnly, setLowSecOnly] = useState(false);
  const [evaluating, setEvaluating] = useState<any>(null);

  useEffect(() => { (async () => {
    const cs = await fetchApi('/eval/cycles');
    setCycles(cs);
    const active = cs.find((c: any) => c.active) || cs[0];
    if (active) setCycleId(active.id);
  })(); }, []);

  useEffect(() => {
    if (cycleId == null) return;
    (async () => {
      setLoading(true);
      try { setData(await fetchApi(`/eval/dashboard/auditor?cycle_id=${cycleId}`)); }
      finally { setLoading(false); }
    })();
  }, [cycleId]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.instances.filter((i: any) => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (lowSecOnly && !(i.seguranca_pct != null && i.seguranca_pct < 60)) return false;
      if (!q) return true;
      return (i.provider_name || '').toLowerCase().includes(q)
        || (i.provider_code || '').toLowerCase().includes(q);
    });
  }, [data, search, statusFilter, lowSecOnly]);

  // Status presentes no ciclo (pra montar as opções do dropdown).
  const statusesPresent = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.instances.map((i: any) => i.status))) as string[];
  }, [data]);

  const reopen = async (inst: any) => {
    if (!confirm(`Devolver a avaliação de "${inst.provider_name}" para o prestador?`)) return;
    await fetchApi(`/eval/instances/${inst.id}/reopen`, { method: 'POST' });
    setData(await fetchApi(`/eval/dashboard/auditor?cycle_id=${cycleId}`));
  };

  if (loading || !data) {
    return <div className="p-8 text-center text-gray-500">Carregando painel...</div>;
  }

  const k = data.kpis;
  const sentPct = k.sent + k.pending > 0 ? Math.round((k.sent / (k.sent + k.pending)) * 100) : 0;
  const sealPieData = Object.entries(k.seal_distribution).filter(([, v]) => (v as number) > 0).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Painel do Ciclo</h1>
          <p className="text-sm text-gray-500">
            {data.cycle.label} · {data.cycle.start_date} → {data.cycle.end_date}
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <select
            className="border rounded-lg px-3 py-2 text-sm bg-white"
            value={cycleId ?? ''}
            onChange={e => setCycleId(Number(e.target.value))}
          >
            {cycles.map(c => (
              <option key={c.id} value={c.id}>{c.label}{c.active ? ' (ativo)' : ''}</option>
            ))}
          </select>
          <a
            href={`/api/eval/dashboard/auditor.xlsx?cycle_id=${cycleId}`}
            className="btn btn-outline flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Exportar .xlsx
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={<Building2 className="w-5 h-5" />} label="Locais no ciclo" value={k.total_locations} tone="blue" />
        <Kpi icon={<ClipboardList className="w-5 h-5" />} label="Enviados / Pendentes" value={`${k.sent} / ${k.pending}`} sub={`${sentPct}% enviados`} tone="emerald" />
        <Kpi icon={<Eye className="w-5 h-5" />} label="Em análise" value={k.in_review} tone="purple" />
        <Kpi icon={<Clock className="w-5 h-5" />} label="Aguardando reanálise" value={k.awaiting_provider} tone="orange" />
        <Kpi icon={<TrendingUp className="w-5 h-5" />} label="Média geral" value={`${k.avg_score.toFixed(1)}%`} tone="indigo" />
        <Kpi icon={<AlertTriangle className="w-5 h-5" />} label="Segurança < 60%" value={k.low_security_count} tone={k.low_security_count > 0 ? 'red' : 'gray'} />
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 font-medium mb-2 flex items-center gap-2"><Award className="w-4 h-4" /> Selos</p>
          <div className="h-24">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={sealPieData} dataKey="value" nameKey="name" innerRadius={20} outerRadius={40}>
                  {sealPieData.map((s: any) => <Cell key={s.name} fill={SEAL_COLORS[s.name] || '#9CA3AF'} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 font-medium mb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Grupos (top 5)</p>
          <div className="h-24">
            <ResponsiveContainer>
              <BarChart data={k.group_distribution.slice(0, 5)} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="group" hide />
                <Tooltip />
                <Bar dataKey="count" fill="#00995D" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por prestador ou código..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border-none rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-50 border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Todos os status ({data.instances.length})</option>
            {statusesPresent.map(st => (
              <option key={st} value={st}>
                {statusLabel(st)} ({data.instances.filter((i: any) => i.status === st).length})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setLowSecOnly(v => !v)}
            aria-pressed={lowSecOnly}
            title="Mostrar apenas prestadores com Segurança abaixo de 60%"
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
              lowSecOnly
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-red-700 border-red-200 hover:bg-red-50'
            }`}
          >
            <AlertTriangle className="w-4 h-4" /> Segurança &lt; 60% ({k.low_security_count})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-3 font-semibold text-gray-600 text-sm">Prestador</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Código</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Município</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Status</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Pontuação</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Segurança</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">Nenhum resultado.</td></tr>
              ) : filtered.map((i: any) => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-900">{i.provider_name}</td>
                  <td className="p-3 text-sm text-gray-600">{i.provider_code || '—'}</td>
                  <td className="p-3 text-sm text-gray-600">{i.city || '—'}</td>
                  <td className="p-3">
                    <span className={`inline-block whitespace-nowrap px-2.5 py-1 text-[10px] font-bold uppercase rounded-full tracking-wide ${statusPill(i.status)}`}>
                      {statusLabel(i.status)}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-gray-700">{Number(i.percentual).toFixed(0)}%</td>
                  <td className="p-3">
                    {i.seguranca_pct == null ? (
                      <span className="text-sm text-gray-400">—</span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded text-sm font-bold ${i.seguranca_pct < 60 ? 'bg-red-100 text-red-700' : 'text-gray-700'}`}>
                        {Number(i.seguranca_pct).toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEvaluating(i)}
                        title={['aprovado','reprovado','finalizado','ciclo_encerrado'].includes(i.status) ? 'Visualizar avaliação' : 'Analisar avaliação'}
                        aria-label={['aprovado','reprovado','finalizado','ciclo_encerrado'].includes(i.status) ? 'Visualizar avaliação' : 'Analisar avaliação'}
                        className="p-1.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      ><Eye className="w-4 h-4" /></button>
                      {i.status === 'em_analise' && (
                        <button
                          onClick={() => reopen(i)}
                          title="Devolver a avaliação para o prestador reeditar"
                          aria-label="Devolver a avaliação para o prestador reeditar"
                          className="p-1.5 rounded bg-orange-50 text-orange-700 hover:bg-orange-100"
                        ><Undo2 className="w-4 h-4" /></button>
                      )}
                      <button
                        disabled={!i.has_certificate}
                        title={i.has_certificate ? 'Ver certificado' : 'Certificado disponível após parecer final'}
                        aria-label={i.has_certificate ? 'Ver certificado' : 'Certificado indisponível'}
                        className="p-1.5 rounded bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      ><Award className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {evaluating && (
        <AuditorPlayer
          instanceId={evaluating.id}
          onClose={async () => {
            setEvaluating(null);
            if (cycleId != null) setData(await fetchApi(`/eval/dashboard/auditor?cycle_id=${cycleId}`));
          }}
        />
      )}
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone: 'blue'|'emerald'|'purple'|'orange'|'indigo'|'red'|'gray' }) {
  const bg = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', purple: 'bg-purple-50 text-purple-600', orange: 'bg-orange-50 text-orange-600', indigo: 'bg-indigo-50 text-indigo-600', red: 'bg-red-50 text-red-600', gray: 'bg-gray-50 text-gray-500' }[tone];
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bg}`}>{icon}</div>
        <div>
          <p className="text-xs text-gray-500 font-medium">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
          {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
