import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { Bell, Calendar } from 'lucide-react';

export default function Comunicados() {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadAnnouncements = async () => {
      try {
        const data = await fetchApi('/announcements');
        setAnnouncements(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadAnnouncements();
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando comunicados...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Comunicados Institucionais</h1>
      </div>

      <div className="space-y-4">
        {announcements.map((ann) => (
          <div key={ann.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-xl font-bold text-gray-900 flex items-center">
                <Bell className="h-5 w-5 mr-3 text-emerald-600" />
                {ann.title}
              </h2>
              <div className="flex gap-2">
                {ann.target_type && ann.target_type !== 'geral' && (
                  <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                    {ann.target_type === 'grupo' ? `Grupo: ${ann.target_group}` : 'Específico'}
                  </span>
                )}
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                  {ann.category}
                </span>
              </div>
            </div>
            <p className="text-gray-700 mt-4 leading-relaxed">{ann.description}</p>
            <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
              <div className="flex items-center text-sm text-gray-500">
                <Calendar className="h-4 w-4 mr-2" />
                {new Date(ann.date).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: 'long', year: 'numeric'
                })}
              </div>
              <button className="text-emerald-600 hover:text-emerald-700 text-sm font-medium">
                Marcar como lido
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
