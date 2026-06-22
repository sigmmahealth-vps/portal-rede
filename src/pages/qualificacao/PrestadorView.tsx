import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Play, FileText, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import RoteiroPlayer from './RoteiroPlayer';

export default function PrestadorView({ user }: { user: any }) {
  const [scripts, setScripts] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePlayer, setActivePlayer] = useState<{ scriptId: number, instanceId?: number } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [scriptsData, instancesData] = await Promise.all([
        fetchApi('/eval/scripts'),
        fetchApi('/eval/instances')
      ]);
      setScripts(scriptsData);
      setInstances(instancesData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (activePlayer) {
    return (
      <RoteiroPlayer 
        scriptId={activePlayer.scriptId} 
        instanceId={activePlayer.instanceId} 
        providerId={user.provider_id}
        onClose={() => {
          setActivePlayer(null);
          loadData();
        }} 
      />
    );
  }

  const scriptsVigentes = scripts.filter((s: any) => s.is_current !== false);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Programas de Qualificação</h1>
        <p className="text-gray-500">Mantenha sua qualificação em dia respondendo aos roteiros da RN 630.</p>
      </div>

      {!loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-900 border-b pb-2">Roteiros Disponíveis</h2>
            {scriptsVigentes.map(s => {
              // check if already have instance
              const existing = instances.find(i => i.script_id === s.id && i.status !== 'finalizado' && i.status !== 'aprovado' && i.status !== 'reprovado');
              return (
                <div key={s.id} className="bg-white border border-emerald-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-gray-900">{s.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{s.description}</p>
                    </div>
                  </div>
                  <div className="mt-6">
                    <button 
                      onClick={() => setActivePlayer({ scriptId: s.id, instanceId: existing?.id })}
                      className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors w-full justify-center"
                    >
                      {existing ? (
                        <><Clock className="w-4 h-4" /> Continuar Avaliação</>
                      ) : (
                        <><Play className="w-4 h-4" /> Iniciar Avaliação</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-bold text-gray-900 border-b pb-2">Meu Histórico</h2>
            {instances.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhum histórico encontrado.</p>
            ) : instances.map(inst => (
              <div key={inst.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{inst.script_title}</h3>
                    <p className="text-xs text-gray-500 mt-1">Enviado em: {new Date(inst.started_at).toLocaleDateString()}</p>
                  </div>
                  {inst.status === 'finalizado' && inst.seal ? (
                     <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide flex items-center gap-1">
                       Selo {inst.seal}
                     </span>
                  ) : (
                    <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                      {inst.status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-4 text-sm font-medium">
                  <div className="flex flex-col">
                    <span className="text-gray-500 text-xs">Score</span>
                    <span className={inst.percentual >= 80 ? 'text-emerald-600' : 'text-amber-600'}>
                      {Number(inst.percentual).toFixed(0)}%
                    </span>
                  </div>
                </div>

              </div>
            ))}
          </div>

        </div>
      ) : (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
        </div>
      )}
    </div>
  );
}
