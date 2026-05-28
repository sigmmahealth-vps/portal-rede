import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { ClipboardCheck, Calendar, CheckCircle, Clock } from 'lucide-react';

export default function Auditorias() {
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadAudits = async () => {
      try {
        const data = await fetchApi('/audits');
        setAudits(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadAudits();
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando auditorias...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Agenda de Auditorias</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Programada</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avaliação</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {audits.map((audit) => (
                <tr key={audit.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Calendar className="h-5 w-5 text-gray-400 mr-3" />
                      <div className="text-sm font-medium text-gray-900">
                        {new Date(audit.scheduled_date).toLocaleDateString('pt-BR', {
                          day: '2-digit', month: 'long', year: 'numeric'
                        })}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {audit.status === 'programada' ? (
                        <>
                          <Clock className="h-5 w-5 text-amber-500 mr-2" />
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800">Programada</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-5 w-5 text-emerald-500 mr-2" />
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800">Realizada</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {audit.evaluation || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <a href="#" className="text-emerald-600 hover:text-emerald-900">Ver Detalhes</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
