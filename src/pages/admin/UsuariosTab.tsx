import { useEffect, useState } from 'react';
import { Plus, Search, MoreVertical } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import NovoUsuarioModal from './NovoUsuarioModal';

interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'auditoria' | 'prestador' | 'cooperado';
  is_active: boolean;
  invite_status: 'pending' | 'accepted' | 'expired';
  last_login_at: string | null;
}

const STATUS_BADGE = (u: User) => {
  if (!u.is_active) return { label: 'Inativo', color: 'bg-red-100 text-red-700' };
  if (u.invite_status === 'pending') return { label: 'Pendente', color: 'bg-amber-100 text-amber-800' };
  if (u.invite_status === 'expired') return { label: 'Expirado', color: 'bg-gray-200 text-gray-600' };
  return { label: 'Ativo', color: 'bg-emerald-100 text-emerald-700' };
};

export default function UsuariosTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openModal, setOpenModal] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchApi('/users').then(setUsers).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const patch = async (id: number, body: Partial<{ role: User['role']; is_active: boolean }>) => {
    setMenuOpenFor(null);
    try {
      await fetchApi(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const resend = async (id: number) => {
    setMenuOpenFor(null);
    try {
      await fetchApi(`/users/${id}/resend-invite`, { method: 'POST' });
      load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou e-mail..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
        </div>
        <button onClick={() => setOpenModal(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-md font-medium hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Novo usuário
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}

      {loading ? (
        <p className="text-gray-500">Carregando...</p>
      ) : (
        <table className="w-full bg-white rounded-xl overflow-hidden border border-gray-100">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left p-3">Nome</th>
              <th className="text-left p-3">E-mail</th>
              <th className="text-left p-3">Função</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Último acesso</th>
              <th className="p-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const s = STATUS_BADGE(u);
              return (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="p-3 font-medium text-gray-900">{u.name}</td>
                  <td className="p-3 text-gray-700">{u.email}</td>
                  <td className="p-3 capitalize">{u.role}</td>
                  <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span></td>
                  <td className="p-3 text-gray-500 text-sm">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('pt-BR') : '—'}</td>
                  <td className="p-3 relative">
                    <button onClick={() => setMenuOpenFor(menuOpenFor === u.id ? null : u.id)} className="text-gray-400 hover:text-gray-700"><MoreVertical /></button>
                    {menuOpenFor === u.id && (
                      <div className="absolute right-0 top-10 z-20 bg-white border border-gray-200 rounded-md shadow-lg py-1 w-56">
                        {(u.role === 'admin' || u.role === 'auditoria') && (
                          <button onClick={() => patch(u.id, { role: u.role === 'admin' ? 'auditoria' : 'admin' })}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            Mudar role para {u.role === 'admin' ? 'auditoria' : 'admin'}
                          </button>
                        )}
                        <button onClick={() => patch(u.id, { is_active: !u.is_active })}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                          {u.is_active ? 'Desativar' : 'Reativar'}
                        </button>
                        {(u.invite_status === 'pending' || u.invite_status === 'expired') && (
                          <button onClick={() => resend(u.id)}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            Reenviar convite
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-gray-500">Nenhum usuário encontrado.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {openModal && <NovoUsuarioModal onClose={() => setOpenModal(false)} onCreated={load} />}
    </div>
  );
}
