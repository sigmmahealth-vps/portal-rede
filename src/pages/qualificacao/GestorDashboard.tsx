import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import {
  Building2,
  CheckCircle,
  TrendingUp,
  AlertTriangle,
  MapPin
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';

const SEAL_COLORS: Record<string, string> = {
  'Ouro': '#FCD34D', 'Prata': '#9CA3AF', 'Bronze': '#B45309', 'Não Qualificado': '#EF4444',
};

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// 'YYYY-MM' → 'mmm/aa' (ex.: '2026-07' → 'jul/26'). Fallback: valor cru.
const fmtMonth = (v: any): string => {
  const [y, m] = String(v).split('-');
  const i = Number(m) - 1;
  return MESES[i] ? `${MESES[i]}/${y.slice(2)}` : String(v);
};

const FUNNEL: { key: string; label: string; color: string }[] = [
  { key: 'pendente',             label: 'Não iniciado',    color: 'bg-gray-400' },
  { key: 'em_andamento',         label: 'Em preenchimento', color: 'bg-blue-500' },
  { key: 'em_analise',           label: 'Em análise',      color: 'bg-amber-500' },
  { key: 'aguardando_evidencia', label: 'Devolvido',       color: 'bg-orange-500' },
  { key: 'concluido',            label: 'Concluído',       color: 'bg-emerald-500' },
];
// Conta por estado a partir de by_status; 'concluido' agrega aprovado/reprovado/finalizado.
function funnelCounts(byStatus: any[]): Record<string, number> {
  const c = (s: string) => Number((byStatus || []).find((r: any) => r.status === s)?.count || 0);
  return {
    pendente: c('pendente'), em_andamento: c('em_andamento'), em_analise: c('em_analise'),
    aguardando_evidencia: c('aguardando_evidencia'),
    concluido: c('aprovado') + c('reprovado') + c('finalizado'),
  };
}

export default function GestorDashboard({ user }: { user: any }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null); // null = todos os ciclos

  useEffect(() => {
    (async () => { try { setCycles(await fetchApi('/eval/cycles')); } catch { /* mantém "todos" */ } })();
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [cycleId]);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const qs = cycleId != null ? `?cycle_id=${cycleId}` : '';
      setData(await fetchApi(`/eval/dashboard${qs}`));
    } catch (err) {
      console.error('Erro ao carregar dashboard', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard de Qualificação</h1>
          <p className="text-sm text-gray-500">Visão Estratégica da Rede Prestadora - RN 630</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">Ciclo:</span>
            <select
              value={cycleId ?? ''}
              onChange={e => setCycleId(e.target.value ? Number(e.target.value) : null)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="">Todos os ciclos</option>
              {cycles.map((c: any) => (
                <option key={c.id} value={c.id}>{c.label}{c.active ? ' (ativo)' : ''}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!loading && data ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            <StatCard icon={Building2} iconBg="bg-blue-50" iconColor="text-blue-600" label="Total de Avaliações" value={data.total}>
              {(() => {
                const byStatus: any[] = data.by_status || [];
                const countOf = (s: string) => Number(byStatus.find((r) => r.status === s)?.count || 0);
                const finalizadas = countOf('finalizado') + countOf('aprovado');
                const pendentes = countOf('pendente');
                const provs = Number(data.providers_evaluated || 0);
                const total = Number(data.total || 0);
                const parts: string[] = [];
                if (finalizadas > 0) parts.push(`${finalizadas} ${finalizadas === 1 ? 'finalizada' : 'finalizadas'}`);
                if (pendentes > 0) parts.push(`${pendentes} ${pendentes === 1 ? 'pendente' : 'pendentes'}`);
                // Só sinaliza multi-unidade quando prestadores < instâncias.
                if (provs > 0 && provs < total) parts.push(`em ${provs} ${provs === 1 ? 'prestador' : 'prestadores'}`);
                return parts.length ? <p className="mt-1 text-xs text-gray-500">{parts.join(' · ')}</p> : null;
              })()}
            </StatCard>

            <StatCard icon={MapPin} iconBg="bg-indigo-50" iconColor="text-indigo-600" label="Cobertura da rede"
              value={`${Number(data.addresses_evaluated || 0)} / ${Number(data.network_total || 0)}`}>
              {(() => {
                const net = Number(data.network_total || 0);
                const pct = net ? Math.round((Number(data.addresses_evaluated || 0) / net) * 100) : 0;
                return (
                  <div className="mt-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{pct}% dos endereços com roteiro</p>
                  </div>
                );
              })()}
            </StatCard>

            <StatCard icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600" label="Endereços qualificados"
              value={(() => {
                const net = Number(data.network_total || 0);
                const pct = net ? Math.round((Number(data.addresses_qualified || 0) / net) * 100) : 0;
                return `${Number(data.addresses_qualified || 0)} (${pct}%)`;
              })()} />

            <StatCard icon={TrendingUp} iconBg="bg-purple-50" iconColor="text-purple-600" label="Score médio"
              value={`${Number(data.avg_score).toFixed(1)}%`} />

            <StatCard icon={AlertTriangle} iconBg={data.action_plans?.overdue > 0 ? 'bg-red-50' : 'bg-gray-50'}
              iconColor={data.action_plans?.overdue > 0 ? 'text-red-600' : 'text-gray-500'} label="Planos de ação atrasados"
              value={Number(data.action_plans?.overdue || 0)}>
              <p className="mt-1 text-xs text-gray-500">
                {Number(data.action_plans?.open || 0)} abertos · {Number(data.action_plans?.concluded || 0)} concluídos
              </p>
            </StatCard>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Andamento do ciclo</h3>
            {(() => {
              const counts = funnelCounts(data.by_status);
              const max = Math.max(1, ...FUNNEL.map(f => counts[f.key]));
              return (
                <div className="space-y-3">
                  {FUNNEL.map(f => (
                    <div key={f.key} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 text-sm text-gray-600">{f.label}</span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                        <div className={`h-full ${f.color}`} style={{ width: `${(counts[f.key] / max) * 100}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm font-bold tabular-nums text-gray-900">{counts[f.key]}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Não-conformidade por dimensão</h3>
              {(data.by_dimension_nc || []).length === 0 ? (
                <p className="text-sm text-gray-400">Sem respostas avaliadas ainda.</p>
              ) : (
                <div className="space-y-3">
                  {(data.by_dimension_nc || []).map((d: any) => (
                    <div key={d.dimension} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm text-gray-600" title={d.dimension}>{d.dimension}</span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                        <div className="h-full bg-red-500" style={{ width: `${d.rate}%` }} />
                      </div>
                      <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-gray-900">{d.rate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Critérios mais reprovados</h3>
              {(data.top_nc_criteria || []).length === 0 ? (
                <p className="text-sm text-gray-400">Nenhuma não-conformidade registrada.</p>
              ) : (
                <ul className="space-y-2">
                  {(data.top_nc_criteria || []).map((t: any) => (
                    <li key={t.question_code} className="flex items-start gap-3">
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gray-600">{t.question_code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={t.question_text}>{t.question_text}</span>
                      <span className="shrink-0 text-sm font-bold text-red-600">{t.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Engajamento na Pesquisa de Satisfação</h3>
            {(() => {
              const e = data.survey_engagement || {};
              return (
                <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-gray-500">Taxa de resposta</p>
                    <p className="text-2xl font-bold text-gray-900">{Number(e.response_rate || 0)}%</p>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Number(e.response_rate || 0)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{Number(e.responded || 0)} de {Number(e.available || 0)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Respondidas no prazo</p>
                    <p className="text-2xl font-bold text-gray-900">{Number(e.within_deadline_rate || 0)}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">NPS</p>
                    <p className="text-2xl font-bold text-gray-900">{e.nps == null ? '—' : e.nps}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">CSAT (geral)</p>
                    <p className="text-2xl font-bold text-gray-900">{e.csat == null ? '—' : `${e.csat}/5`}</p>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Evolução do Nível de Conformidade</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.evolution || []} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis
                      dataKey="name" axisLine={false} tickLine={false}
                      tick={{ fill: '#6B7280', fontSize: 12 }}
                      tickFormatter={fmtMonth} padding={{ left: 24, right: 24 }} minTickGap={24}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} domain={[0, 100]} width={32} />
                    <Tooltip cursor={{ stroke: '#F3F4F6', strokeWidth: 2 }} labelFormatter={fmtMonth} formatter={(v: any) => [`${v}%`, 'Média']} />
                    <Line type="monotone" dataKey="media" stroke="#00995D" strokeWidth={3} dot={{ r: 4, fill: '#00995D', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Classificação da Rede (Selos)</h3>
              <div className="h-72 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.seal_distribution || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {(data.seal_distribution || []).map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={SEAL_COLORS[entry.name] || '#CBD5E1'} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, iconBg, iconColor, label, value, children }: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string; iconColor: string;
  label: string; value: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${iconBg}`}>
        <Icon className={`h-6 w-6 ${iconColor}`} />
      </div>
      <div className="min-w-0">
        {/* min-h reserva 2 linhas p/ o valor alinhar entre cards com rótulo de 1 ou 2 linhas */}
        <p className="min-h-[2.5rem] text-sm font-medium leading-5 text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {children}
      </div>
    </div>
  );
}
