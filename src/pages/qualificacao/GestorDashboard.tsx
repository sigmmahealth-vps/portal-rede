import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { 
  Building2, 
  CheckCircle, 
  TrendingUp, 
  AlertTriangle,
  Award,
  Search,
  ArrowRight
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

export default function GestorDashboard({ user }: { user: any }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const dbData = await fetchApi('/eval/dashboard');
      setData(dbData);
    } catch (err) {
      console.error('Erro ao carregar dashboard', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'em_andamento': return 'text-blue-600 bg-blue-100';
      case 'pendente': return 'text-amber-600 bg-amber-100';
      case 'finalizado': return 'text-emerald-600 bg-emerald-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const exportRankingCsv = () => {
    const rows = data?.ranking || [];
    const headers = ['Colocacao', 'Prestador', 'Score', 'Selo'];
    const csvContent = [
      headers.join(','),
      ...rows.map((r: any, i: number) =>
        [i + 1, `"${(r.provider || '').replace(/"/g, '""')}"`, r.score, r.seal || ''].join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'ranking_qualificacao.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard de Qualificação</h1>
          <p className="text-sm text-gray-500">Visão Estratégica da Rede Prestadora - RN 630</p>
        </div>
        <div className="flex gap-3">
          <button
            className="btn btn-outline"
            onClick={exportRankingCsv}
          >
            Exportar Relatório
          </button>
        </div>
      </div>

      {!loading && data ? (
        <>
          {/* Main indicators */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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

            <StatCard icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600" label="Prestadores Qualificados" value={data.approved} />
            <StatCard icon={TrendingUp} iconBg="bg-purple-50" iconColor="text-purple-600" label="Score Médio" value={`${Number(data.avg_score).toFixed(1)}%`} />
            <StatCard icon={AlertTriangle} iconBg="bg-amber-50" iconColor="text-amber-600" label="Não Conformidades" value={data.non_conformities} />
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

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Ranking Top Prestadores</h3>
              <button className="text-sm text-emerald-600 font-medium flex items-center gap-1 hover:underline">
                Ver todos <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="p-0">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Colocação</th>
                    <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Prestador</th>
                    <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Score</th>
                    <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Selo</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.ranking || []).map((r: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="p-4"><div className="w-8 h-8 rounded bg-gray-100 text-gray-700 font-bold flex items-center justify-center">{i + 1}º</div></td>
                      <td className="p-4 font-medium text-gray-900">
                        {r.provider}
                        {r.location_label && (
                          <span className="ml-1 text-xs font-normal text-gray-500">— {r.location_label}</span>
                        )}
                      </td>
                      <td className="p-4 font-bold text-emerald-600">{r.score}%</td>
                      <td className="p-4">{r.seal
                        ? <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wide">{r.seal}</span>
                        : <span className="text-gray-400 text-xs">—</span>}</td>
                    </tr>
                  ))}
                  {(!data.ranking || data.ranking.length === 0) && (
                    <tr><td colSpan={4} className="p-6 text-center text-gray-400 text-sm">Nenhuma avaliação finalizada ainda.</td></tr>
                  )}
                </tbody>
              </table>
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
