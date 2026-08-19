import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import {
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

const SEAL_COLORS: Record<string, string> = {
  'Ouro': '#FCD34D', 'Prata': '#9CA3AF', 'Bronze': '#B45309', 'Não Qualificado': '#EF4444',
};

// Artes oficiais das medalhas (mesmas dos e-mails); Não Qualificado segue só com a cor.
const SEAL_IMG: Record<string, string> = {
  'Ouro': '/selos/ouro.png', 'Prata': '/selos/prata.png', 'Bronze': '/selos/bronze.png',
};

function SealLegend({ payload }: any) {
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 pt-2">
      {(payload || []).map((p: any) => (
        <span key={p.value} className="inline-flex items-center gap-1.5 text-sm text-gray-600">
          {SEAL_IMG[p.value]
            ? <img src={SEAL_IMG[p.value]} alt="" className="h-5 w-5 object-contain" />
            : <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />}
          {p.value}
        </span>
      ))}
    </div>
  );
}

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
          {/* KPIs (padrão do dashboard da Pesquisa) */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Card label="Total de Avaliações" value={data.total} sub={(() => {
              const byStatus: any[] = data.by_status || [];
              const countOf = (s: string) => Number(byStatus.find((r) => r.status === s)?.count || 0);
              const finalizadas = countOf('finalizado') + countOf('aprovado');
              const pendentes = countOf('pendente');
              const provs = Number(data.providers_evaluated || 0);
              const total = Number(data.total || 0);
              const parts: string[] = [];
              if (finalizadas > 0) parts.push(`${finalizadas} ${finalizadas === 1 ? 'finalizada' : 'finalizadas'}`);
              if (pendentes > 0) parts.push(`${pendentes} ${pendentes === 1 ? 'pendente' : 'pendentes'}`);
              if (provs > 0 && provs < total) parts.push(`em ${provs} ${provs === 1 ? 'prestador' : 'prestadores'}`);
              return parts.join(' · ') || undefined;
            })()} />

            <Card label="Cobertura"
              value={(() => { const net = Number(data.network_total || 0); return `${net ? Math.round((Number(data.addresses_evaluated || 0) / net) * 100) : 0}%`; })()}
              sub={`${Number(data.addresses_evaluated || 0)} de ${Number(data.network_total || 0)} endereços`} />

            <Card label="Qualificados"
              value={(() => { const net = Number(data.network_total || 0); return `${net ? Math.round((Number(data.addresses_qualified || 0) / net) * 100) : 0}%`; })()}
              sub={`${Number(data.addresses_qualified || 0)} de ${Number(data.network_total || 0)} endereços`} />

            <Card label="Score médio" value={`${Number(data.avg_score).toFixed(1)}%`} sub="média das concluídas" />

            <Card label="Planos atrasados" value={Number(data.action_plans?.overdue || 0)}
              sub={`${Number(data.action_plans?.open || 0)} abertos · ${Number(data.action_plans?.concluded || 0)} concluídos`} />
          </div>

          {/* Análise comparativa por ciclo — observar a evolução */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 p-4">
              <h3 className="text-lg font-bold text-gray-900">Análise comparativa por ciclo</h3>
              <p className="text-xs text-gray-500">Evolução dos indicadores da rede entre ciclos</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="p-3">Ciclo</th>
                    <th className="p-3">Avaliações</th>
                    <th className="p-3">Cobertura</th>
                    <th className="p-3">Qualificados</th>
                    <th className="p-3">Score médio</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.cycles_comparison || []).length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-gray-400">Nenhum ciclo.</td></tr>
                  ) : (data.cycles_comparison || []).map((c: any) => {
                    const net = Number(data.network_total || 0);
                    const cov = net ? Math.round((Number(c.addresses_evaluated || 0) / net) * 100) : 0;
                    return (
                      <tr key={c.id} className="border-t border-gray-50">
                        <td className="p-3 font-medium text-gray-900">
                          {c.label}
                          {c.active && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">ativo</span>}
                        </td>
                        <td className="p-3 text-gray-600">{c.evaluations}</td>
                        <td className="p-3 text-gray-600">{cov}% <span className="text-xs text-gray-400">({c.addresses_evaluated})</span></td>
                        <td className="p-3 text-gray-600">{c.qualified}</td>
                        <td className="p-3 font-semibold text-gray-700">{c.avg_score == null ? '—' : `${c.avg_score}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                  {(data.top_nc_criteria || []).slice(0, 5).map((t: any) => (
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
              <h3 className="text-lg font-bold text-gray-900 mb-4">Distribuição de scores</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.score_histogram || []} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="bucket" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} allowDecimals={false} width={32} />
                    <Tooltip cursor={{ fill: '#F3F4F6' }} formatter={(v: any) => [v, 'Avaliações']} />
                    <Bar dataKey="count" fill="#00995D" radius={[4, 4, 0, 0]} />
                  </BarChart>
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
                    <Legend content={<SealLegend />} />
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

// Card de métrica no padrão do dashboard da Pesquisa (rótulo, número grande, legenda).
function Card({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-secondary-900">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
