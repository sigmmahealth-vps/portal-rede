import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Search, Filter, ShieldCheck, Clock, Check, X, Eye } from 'lucide-react';
import AuditorEvaluationModal from './AuditorEvaluationModal';

export default function AuditorView({ user }: { user: any }) {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [evaluatingInstance, setEvaluatingInstance] = useState<any>(null);

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    try {
      setLoading(true);
      const data = await fetchApi('/eval/instances');
      setInstances(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = instances.filter(i => 
    i.provider_name.toLowerCase().includes(search.toLowerCase()) ||
    i.script_title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Auditoria de Qualificação</h2>
          <p className="text-sm text-gray-500">Módulo de análise e certificação RNC 630</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Buscar por prestador..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border-none rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button className="btn btn-outline flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filtros
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 font-semibold text-gray-600 text-sm">Prestador</th>
                <th className="p-4 font-semibold text-gray-600 text-sm">Roteiro</th>
                <th className="p-4 font-semibold text-gray-600 text-sm">Score Atual</th>
                <th className="p-4 font-semibold text-gray-600 text-sm">Status</th>
                <th className="p-4 font-semibold text-gray-600 text-sm">Selo</th>
                <th className="p-4 font-semibold text-gray-600 text-sm">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                     <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600 mx-auto"></div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">Nenhuma avaliação encontrada.</td>
                </tr>
              ) : filtered.map(inst => (
                <tr key={inst.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-medium text-gray-900">{inst.provider_name}</td>
                  <td className="p-4 text-sm text-gray-600">{inst.script_title}</td>
                  <td className="p-4 font-bold text-gray-700">{Number(inst.percentual).toFixed(0)}%</td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-full tracking-wide ${
                      inst.status === 'pendente' ? 'bg-amber-100 text-amber-800' :
                      inst.status === 'finalizado' ? 'bg-emerald-100 text-emerald-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {inst.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-4">
                    {inst.seal ? (
                      <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${inst.seal === 'Ouro' ? 'bg-yellow-100 text-yellow-800' : inst.seal === 'Prata' ? 'bg-gray-200 text-gray-800' : 'bg-orange-100 text-orange-800'}`}>
                        {inst.seal}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="p-4">
                    <button 
                      onClick={() => setEvaluatingInstance(inst)}
                      className="text-emerald-600 hover:text-emerald-800 font-medium text-sm flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Eye className="w-4 h-4" /> Analisar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {evaluatingInstance && (
        <AuditorEvaluationModal 
          instanceId={evaluatingInstance.id}
          onClose={() => {
            setEvaluatingInstance(null);
            loadInstances();
          }} 
        />
      )}
    </div>
  );
}
