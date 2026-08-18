import { useEffect, useState } from 'react';
import { Plus, Search, MoreVertical } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import NovoUsuarioModal from './NovoUsuarioModal';

interface User {
  id: number;
  name: string;
  email: string | null;
  role: 'admin' | 'auditoria' | 'prestador' | 'cooperado';
  is_active: boolean;
  invite_status: 'pending' | 'accepted' | 'expired';
  last_login_at: string | null;
}

const STATUS_BADGE = (u: User) => {
  if (!u.is_active) return { label: 'Inativo', color: 'bg-red-100 text-red-700' };
  // Gerado do cadastro sem e-mail utilizável — admin define o e-mail antes do convite.
  if (!u.email) return { label: 'Sem e-mail', color: 'bg-orange-100 text-orange-800' };
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
  const [emailModalUser, setEmailModalUser] = useState<User | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const load = () => {
    setLoading(true);
    fetchApi('/users').then(setUsers).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    if (q && !u.name.toLowerCase().includes(q) && !(u.email ?? '').toLowerCase().includes(q)) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter && STATUS_BADGE(u).label !== statusFilter) return false;
    return true;
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

  const saveEmail = async () => {
    if (!emailModalUser || !emailDraft.trim()) return;
    setSavingEmail(true);
    setError('');
    try {
      await fetchApi(`/users/${emailModalUser.id}`, { method: 'PATCH', body: JSON.stringify({ email: emailDraft.trim() }) });
      setEmailModalUser(null);
      load();
    } catch (e: any) { setError(e.message); } finally { setSavingEmail(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou e-mail..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="border border-gray-300 rounded-md py-2 px-2 text-sm text-gray-700 focus:ring-2 focus:ring-emerald-500">
          <option value="">Função: todas</option>
          <option value="prestador">Prestador</option>
          <option value="cooperado">Cooperado</option>
          <option value="auditoria">Auditoria</option>
          <option value="admin">Admin</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md py-2 px-2 text-sm text-gray-700 focus:ring-2 focus:ring-emerald-500">
          <option value="">Status: todos</option>
          <option value="Ativo">Ativo</option>
          <option value="Pendente">Pendente</option>
          <option value="Sem e-mail">Sem e-mail</option>
          <option value="Expirado">Expirado</option>
          <option value="Inativo">Inativo</option>
        </select>
        <span className="text-sm text-gray-400 whitespace-nowrap">{filtered.length} de {users.length}</span>
        <button onClick={() => setOpenModal(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-md font-medium hover:bg-emerald-700 whitespace-nowrap">
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
                  <td className="p-3 font-medium text-gray-900">
                    <div className="max-w-[240px] truncate" title={u.name}>{u.name}</div>
                  </td>
                  <td className="p-3 text-gray-700">
                    {u.email
                      ? <div className="max-w-[220px] truncate" title={u.email}>{u.email}</div>
                      : <span className="italic text-gray-400">não definido</span>}
                  </td>
                  <td className="p-3 capitalize">{u.role}</td>
                  <td className="p-3"><span className={`whitespace-nowrap px-2 py-1 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span></td>
                  <td className="p-3 text-gray-500 text-sm whitespace-nowrap">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('pt-BR') : '—'}</td>
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
                        <button onClick={() => { setMenuOpenFor(null); setEmailModalUser(u); setEmailDraft(u.email ?? ''); }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                          {u.email ? 'Alterar e-mail' : 'Definir e-mail'}
                        </button>
                        {u.email && (u.invite_status === 'pending' || u.invite_status === 'expired') && (
                          <button onClick={() => resend(u.id)}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            Enviar convite
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

      {emailModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !savingEmail && setEmailModalUser(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800">{emailModalUser.email ? 'Alterar e-mail' : 'Definir e-mail'}</h3>
            <p className="mt-1 text-sm text-gray-500">{emailModalUser.name}</p>
            <form onSubmit={(e) => { e.preventDefault(); saveEmail(); }}>
              <input
                type="email" required autoFocus value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500"
              />
              {emailModalUser.invite_status !== 'accepted' && (
                <p className="mt-2 text-xs text-gray-400">Trocar o e-mail invalida o convite anterior — envie um novo convite pelo menu.</p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setEmailModalUser(null)} disabled={savingEmail}
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                  Cancelar
                </button>
                <button type="submit" disabled={savingEmail}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {savingEmail ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
