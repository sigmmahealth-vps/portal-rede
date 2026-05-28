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
import AuditorView from './AuditorView'; // Admins can probably toggle to Auditor view

export default function GestorDashboard({ user }: { user: any }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'dashboard' | 'auditor'>('dashboard');

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

  if (viewMode === 'auditor') {
    return (
      <div>
        <div className="mb-4">
          <button 
            onClick={() => setViewMode('dashboard')}
            className="text-emerald-600 text-sm font-medium hover:underline flex items-center gap-1"
          >
            ← Voltar para Dashboard Estratégico
          </button>
        </div>
        <AuditorView user={user} />
      </div>
    );
  }

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
            onClick={() => {}}
          >
            Exportar Relatório
          </button>
          <button 
            className="btn btn-primary"
            onClick={() => setViewMode('auditor')}
          >
            Acessar Painel do Auditor
          </button>
        </div>
      </div>

      {!loading && data ? (
        <>
          {/* Main indicators */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
                   <Building2 className="w-6 h-6 text-blue-600" />
                 </div>
                 <div>
                   <p className="text-sm text-gray-500 font-medium">Total de Avaliações</p>
                   <p className="text-2xl font-bold text-gray-900">{data.total}</p>
                 </div>
               </div>
             </div>

             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                   <CheckCircle className="w-6 h-6 text-emerald-600" />
                 </div>
                 <div>
                   <p className="text-sm text-gray-500 font-medium">Prestadores Qualificados</p>
                   <p className="text-2xl font-bold text-gray-900">{data.approved}</p>
                 </div>
               </div>
             </div>

             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-purple-50 flex items-center justify-center">
                   <TrendingUp className="w-6 h-6 text-purple-600" />
                 </div>
                 <div>
                   <p className="text-sm text-gray-500 font-medium">Score Médio</p>
                   <p className="text-2xl font-bold text-gray-900">{Number(data.avg_score).toFixed(1)}%</p>
                 </div>
               </div>
             </div>

             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                   <AlertTriangle className="w-6 h-6 text-amber-600" />
                 </div>
                 <div>
                   <p className="text-sm text-gray-500 font-medium">Não Conformidades</p>
                   <p className="text-2xl font-bold text-gray-900">12</p>
                 </div>
               </div>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Evolução do Nível de Conformidade</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[
                    { name: 'Jan', media: 65 },
                    { name: 'Fev', media: 68 },
                    { name: 'Mar', media: 72 },
                    { name: 'Abr', media: 75 },
                    { name: 'Mai', media: 76 }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#6B7280'}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#6B7280'}} domain={[0, 100]} />
                    <Tooltip cursor={{stroke: '#F3F4F6', strokeWidth: 2}} />
                    <Line type="monotone" dataKey="media" stroke="#00995D" strokeWidth={3} dot={{r: 4, fill: '#00995D', strokeWidth: 0}} />
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
                      data={[
                        { name: 'Ouro', value: 10, color: '#FCD34D' },
                        { name: 'Prata', value: 30, color: '#9CA3AF' },
                        { name: 'Bronze', value: 20, color: '#B45309' },
                        { name: 'Não Qualificado', value: 40, color: '#EF4444' }
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {[
                        { name: 'Ouro', value: 10, color: '#FCD34D' },
                        { name: 'Prata', value: 30, color: '#9CA3AF' },
                        { name: 'Bronze', value: 20, color: '#B45309' },
                        { name: 'Não Qualificado', value: 40, color: '#EF4444' }
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
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
                  <tr className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="p-4"><div className="w-8 h-8 rounded bg-yellow-100 text-yellow-700 font-bold flex items-center justify-center">1º</div></td>
                    <td className="p-4 font-medium text-gray-900">CardioClin Especialidades</td>
                    <td className="p-4 font-bold text-emerald-600">98%</td>
                    <td className="p-4"><span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wide">Ouro</span></td>
                  </tr>
                  <tr className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="p-4"><div className="w-8 h-8 rounded bg-gray-100 text-gray-700 font-bold flex items-center justify-center">2º</div></td>
                    <td className="p-4 font-medium text-gray-900">Hospital São José</td>
                    <td className="p-4 font-bold text-emerald-600">95%</td>
                    <td className="p-4"><span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wide">Ouro</span></td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="p-4"><div className="w-8 h-8 rounded bg-orange-100 text-orange-700 font-bold flex items-center justify-center">3º</div></td>
                    <td className="p-4 font-medium text-gray-900">Clínica de Fisioterapia Movimento</td>
                    <td className="p-4 font-bold text-emerald-600">91%</td>
                    <td className="p-4"><span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wide">Ouro</span></td>
                  </tr>
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
