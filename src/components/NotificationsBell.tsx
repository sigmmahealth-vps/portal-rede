import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { fetchApi } from '../lib/api';

// Sininho do header: badge com contagem de não lidas (polling 60s, pausa com a
// aba oculta); o clique abre direto a caixa de entrada /notificacoes.
export default function NotificationsBell() {
  const [count, setCount] = useState(0);
  const navigate = useNavigate();

  const refreshCount = () => {
    if (document.visibilityState !== 'visible') return;
    fetchApi('/notifications/unread-count').then((d) => setCount(d.count)).catch(() => {});
  };

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <button onClick={() => navigate('/notificacoes')} className="text-gray-500 hover:text-[#00995D] transition-colors relative" title="Notificações">
      <Bell className="h-6 w-6" />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-[#f4f4f4]">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
