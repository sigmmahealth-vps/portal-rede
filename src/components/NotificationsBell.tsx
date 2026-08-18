import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { fetchApi } from '../lib/api';

interface Notif { id: number; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; }

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const refreshCount = () => {
    if (document.visibilityState !== 'visible') return;
    fetchApi('/notifications/unread-count').then(d => setCount(d.count)).catch(() => {});
  };

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      try { setItems((await fetchApi('/notifications')).items); } catch { /* dropdown vazio */ }
    }
  };

  const openItem = async (n: Notif) => {
    setOpen(false);
    if (!n.read_at) {
      fetchApi(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      setCount(c => Math.max(0, c - 1));
    }
    navigate(n.link || '/qualificacao');
  };

  const markAll = async () => {
    try {
      await fetchApi('/notifications/read-all', { method: 'POST' });
      setCount(0);
      setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    } catch { /* mantém como está */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="text-gray-500 hover:text-[#00995D] transition-colors relative" title="Notificações">
        <Bell className="h-6 w-6" />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-[#f4f4f4]">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <h3 className="font-bold text-gray-800">Notificações</h3>
            {count > 0 && (
              <button onClick={markAll} className="text-xs font-medium text-[#00995D] hover:underline">
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-400">Nenhuma notificação.</p>}
            {items.map(n => (
              <button key={n.id} onClick={() => openItem(n)}
                className="block w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-50">
                <p className={`text-sm ${n.read_at ? 'text-gray-500' : 'font-medium text-gray-800'}`}>{n.title}</p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-gray-400">{new Date(n.created_at).toLocaleString('pt-BR')}</p>
              </button>
            ))}
          </div>
          <div className="px-4 py-2 text-center border-t border-gray-100">
            <button onClick={() => { setOpen(false); navigate('/notificacoes'); }} className="text-xs font-bold text-[#00995D]">
              Ver todas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
