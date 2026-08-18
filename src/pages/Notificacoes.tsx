import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { fetchApi } from '../lib/api';

interface Notif { id: number; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; }

export default function Notificacoes() {
  const [items, setItems] = useState<Notif[]>([]);
  const [page, setPage] = useState(1);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = (p: number, unread: boolean) => {
    setLoading(true);
    fetchApi(`/notifications?page=${p}${unread ? '&unread=1' : ''}`)
      .then(d => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, onlyUnread); }, [page, onlyUnread]);

  const openItem = (n: Notif) => {
    if (!n.read_at) fetchApi(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    navigate(n.link || '/qualificacao');
  };

  const markAll = async () => {
    await fetchApi('/notifications/read-all', { method: 'POST' }).catch(() => {});
    load(page, onlyUnread);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-800">
          <Bell className="h-6 w-6 text-[#00995D]" /> Notificações
        </h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={onlyUnread}
              onChange={e => { setPage(1); setOnlyUnread(e.target.checked); }}
              className="rounded border-gray-300 text-[#00995D] focus:ring-[#00995D]/30" />
            Só não lidas
          </label>
          <button onClick={markAll}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <CheckCheck className="h-4 w-4" /> Marcar todas como lidas
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-[#00995D]" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-gray-100 bg-white py-12 text-center text-sm text-gray-400">
          Nenhuma notificação{onlyUnread ? ' não lida' : ''}.
        </p>
      ) : (
        <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
          {items.map(n => (
            <button key={n.id} onClick={() => openItem(n)}
              className="block w-full px-5 py-4 text-left hover:bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <p className={`text-sm ${n.read_at ? 'text-gray-500' : 'font-semibold text-gray-800'}`}>{n.title}</p>
                {!n.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#00995D]" />}
              </div>
              {n.body && <p className="mt-1 text-sm text-gray-500">{n.body}</p>}
              <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString('pt-BR')}</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40">
          Anterior
        </button>
        <span className="text-sm text-gray-500">Página {page}</span>
        <button disabled={items.length < 20} onClick={() => setPage(p => p + 1)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40">
          Próxima
        </button>
      </div>
    </div>
  );
}
