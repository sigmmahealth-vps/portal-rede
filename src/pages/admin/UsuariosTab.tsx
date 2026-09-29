import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, MoreVertical } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import NovoUsuarioModal from './NovoUsuarioModal';
import { fmtDataHora } from '../../lib/formatDate';
import { PRIVACY_POLICY_VERSION } from '../../lib/privacyPolicy';

interface User {
  id: number;
  name: string;
  email: string | null;
  role: 'admin' | 'auditoria' | 'prestador' | 'cooperado' | 'credenciado' | 'pf_nao_medico';
  is_active: boolean;
  invite_status: 'pending' | 'accepted' | 'expired';
  last_login_at: string | null;
  provider_id: number | null;
  provider_code: string | null;
  location_id: number | null;
  location_label: string | null;
  sgu_location_code: string | null;
  privacy_accepted_at: string | null;
  privacy_accepted_version: string | null;
}

// Fronteira de conceito: Equipe interna (operadores) × Acessos de prestadores.
const OPERATOR_ROLES = ['admin', 'auditoria'];
const ROLE_LABEL: Record<User['role'], string> = {
  admin: 'Admin', auditoria: 'Auditoria', prestador: 'Prestador',
  cooperado: 'Médico Cooperado', credenciado: 'Médico Credenciado', pf_nao_medico: 'PF não médico',
};
type Segment = 'equipe' | 'prestadores';

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: 'equipe', label: 'Equipe interna' },
  { id: 'prestadores', label: 'Acessos de prestadores' },
];

const STATUS_BADGE = (u: User) => {
  if (!u.is_active) return { label: 'Inativo', color: 'bg-red-100 text-red-700' };
  // Gerado do cadastro sem e-mail utilizável — admin define o e-mail antes do convite.
  if (!u.email) return { label: 'Sem e-mail', color: 'bg-orange-100 text-orange-800' };
  if (u.invite_status === 'pending') return { label: 'Pendente', color: 'bg-amber-100 text-amber-800' };
  if (u.invite_status === 'expired') return { label: 'Expirado', color: 'bg-gray-200 text-gray-600' };
  return { label: 'Ativo', color: 'bg-emerald-100 text-emerald-700' };
};

const STATUS_OPTIONS: Record<Segment, string[]> = {
  equipe: ['Ativo', 'Pendente', 'Expirado', 'Inativo'],
  prestadores: ['Ativo', 'Pendente', 'Sem e-mail', 'Expirado', 'Inativo'],
};
const ROLE_OPTIONS: Record<Segment, { value: string; label: string }[]> = {
  equipe: [
    { value: 'auditoria', label: 'Auditoria' },
    { value: 'admin', label: 'Admin' },
  ],
  prestadores: [
    { value: 'prestador', label: 'Prestador' },
    { value: 'cooperado', label: 'Médico Cooperado' },
    { value: 'credenciado', label: 'Médico Credenciado' },
    { value: 'pf_nao_medico', label: 'PF não médico' },
  ],
};

export default function UsuariosTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [segment, setSegment] = useState<Segment>('equipe');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openModal, setOpenModal] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [emailModalUser, setEmailModalUser] = useState<User | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = () => {
    setLoading(true);
    fetchApi('/users').then(setUsers).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const switchSegment = (s: Segment) => {
    setSegment(s);
    setRoleFilter('');
    setStatusFilter('');
    setMenuOpenFor(null);
  };

  const inSegment = (u: User) =>
    segment === 'equipe' ? OPERATOR_ROLES.includes(u.role) : !OPERATOR_ROLES.includes(u.role);

  const segmentUsers = users.filter(inSegment);

  const filtered = segmentUsers.filter((u) => {
    const q = search.toLowerCase();
    if (
      q &&
      !u.name.toLowerCase().includes(q) &&
      !(u.email ?? '').toLowerCase().includes(q) &&
      !(u.provider_code ?? '').toLowerCase().includes(q) &&
      !(u.location_label ?? '').toLowerCase().includes(q) &&
      !(u.sgu_location_code ?? '').toLowerCase().includes(q)
    ) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter && STATUS_BADGE(u).label !== statusFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [search, roleFilter, statusFilter, segment, pageSize]);

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
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {SEGMENTS.map((s) => (
          <button
            key={s.id}
            onClick={() => switchSegment(s.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              segment === s.id ? 'bg-white shadow-sm text-[#00995D]' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Adoção dos acessos (spec 2026-09-15 — números por ator): a rede está entrando? */}
      {segment === 'prestadores' && segmentUsers.length > 0 && (() => {
        const by = (label: string) => segmentUsers.filter((u) => STATUS_BADGE(u).label === label).length;
        const ativos = by('Ativo');
        const adocao = Math.round((ativos / segmentUsers.length) * 100);
        return (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <span className="text-sm text-gray-600"><span className="text-xl font-bold text-secondary-900">{adocao}%</span> de adoção</span>
            <span className="text-sm text-gray-600"><span className="font-bold text-emerald-700">{ativos}</span> ativos</span>
            <span className="text-sm text-gray-600"><span className="font-bold text-amber-700">{by('Pendente') + by('Expirado')}</span> convite pendente/expirado</span>
            <span className="text-sm text-gray-600"><span className="font-bold text-orange-700">{by('Sem e-mail')}</span> sem e-mail</span>
            <span className="text-sm text-gray-600"><span className="font-bold text-red-700">{by('Inativo')}</span> inativos</span>
            <span className="text-xs text-gray-400">de {segmentUsers.length} acessos</span>
          </div>
        );
      })()}

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={segment === 'prestadores' ? 'Buscar nome, e-mail ou código...' : 'Buscar nome ou e-mail...'}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="border border-gray-300 rounded-md py-2 px-2 text-sm text-gray-700 focus:ring-2 focus:ring-emerald-500">
          <option value="">Função: todas</option>
          {ROLE_OPTIONS[segment].map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md py-2 px-2 text-sm text-gray-700 focus:ring-2 focus:ring-emerald-500">
          <option value="">Status: todos</option>
          {STATUS_OPTIONS[segment].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-sm text-gray-400 whitespace-nowrap">{filtered.length} de {segmentUsers.length}</span>
        {segment === 'equipe' && (
          <button onClick={() => setOpenModal(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-md font-medium hover:bg-emerald-700 whitespace-nowrap">
            <Plus className="h-4 w-4" /> Novo usuário
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}

      {loading ? (
        <p className="text-gray-500">Carregando...</p>
      ) : (
        // sem overflow-hidden no card: cortava o menu de ações das últimas linhas
        <table className="w-full bg-white rounded-xl border border-gray-100">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left p-3 rounded-tl-xl">Nome</th>
              <th className="text-left p-3">E-mail</th>
              <th className="text-left p-3">Função</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Política</th>
              <th className="text-left p-3">Último acesso</th>
              <th className="p-3 w-10 rounded-tr-xl"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((u) => {
              const s = STATUS_BADGE(u);
              return (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="p-3 font-medium text-gray-900">
                    {segment === 'prestadores' && u.provider_id ? (
                      <Link to={`/admin/prestadores/${u.provider_id}`} title={u.name}
                        className="block max-w-[240px] truncate text-[#00995D] hover:underline">
                        {u.name}
                      </Link>
                    ) : (
                      <div className="max-w-[240px] truncate" title={u.name}>{u.name}</div>
                    )}
                    {segment === 'prestadores' && (u.provider_code || u.location_label) && (
                      <span className="block max-w-[240px] truncate text-xs text-gray-400">
                        {[u.sgu_location_code || u.provider_code, u.location_label].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-gray-700">
                    {u.email
                      ? <div className="max-w-[220px] truncate" title={u.email}>{u.email}</div>
                      : <span className="italic text-gray-400">não definido</span>}
                  </td>
                  <td className="p-3 whitespace-nowrap">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="p-3"><span className={`whitespace-nowrap px-2 py-1 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span></td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    {u.privacy_accepted_version === PRIVACY_POLICY_VERSION ? (
                      <span className="text-gray-500">Aceita em {fmtDataHora(u.privacy_accepted_at)} <span className="text-xs text-gray-400">(v{u.privacy_accepted_version})</span></span>
                    ) : (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                        Pendente{u.privacy_accepted_version ? ` (aceitou v${u.privacy_accepted_version})` : ''}
                      </span>
                    )}
                  </td>
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
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">Nenhum usuário encontrado.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
          <p>
            Mostrando <span className="font-medium text-gray-700">
              {((safePage - 1) * pageSize + 1).toLocaleString('pt-BR')}–{Math.min(safePage * pageSize, filtered.length).toLocaleString('pt-BR')}
            </span>{' de '}<span className="font-medium text-gray-700">{filtered.length.toLocaleString('pt-BR')}</span>
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <span>Por página</span>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-lg border border-gray-200 py-1 pl-2 pr-6 text-sm text-gray-700 focus:border-[#00995D] focus:outline-none focus:ring-2 focus:ring-[#00995D]/20">
                <option value={10}>10</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                  Anterior
                </button>
                <span className="tabular-nums">Página {safePage} de {totalPages}</span>
                <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                  Próxima
                </button>
              </div>
            )}
          </div>
        </div>
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
