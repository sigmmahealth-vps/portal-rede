import React, { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import ProviderContactsPanel from './admin/ProviderContactsPanel';
import { Users, Mail, Phone, Trash2 } from 'lucide-react';

// WS5 — Cadastro de equipe do prestador (§5.2.3 Tela 3).
// Contatos informativos (sem login). Prestador/cooperado gerenciam a própria equipe;
// admin/auditoria escolhem um prestador para visualizar/cadastrar, ou veem a equipe
// de toda a rede junta quando nenhum prestador está selecionado.
export default function Equipe() {
  const [user, setUser] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [ownProviderId, setOwnProviderId] = useState<number | null>(null);
  const [allContacts, setAllContacts] = useState<any[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';
  const showCrossView = isAdmin && !selectedProviderId;

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isAdmin) {
      if (providers.length === 0) fetchApi('/providers').then(setProviders).catch(console.error);
    } else {
      setOwnProviderId(user.provider_id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadAllContacts = () => {
    setLoadingAll(true);
    fetchApi('/provider-contacts')
      .then(setAllContacts)
      .catch(console.error)
      .finally(() => setLoadingAll(false));
  };

  useEffect(() => {
    if (showCrossView) loadAllContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCrossView]);

  const handleDeleteFromCrossView = async (id: number) => {
    if (!window.confirm('Remover este contato da equipe?')) return;
    try {
      await fetchApi(`/provider-contacts/${id}`, { method: 'DELETE' });
      loadAllContacts();
    } catch (err: any) {
      alert(err.message || 'Erro ao remover contato');
    }
  };

  const activeProviderId = isAdmin ? (selectedProviderId || null) : ownProviderId;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Equipe / Profissionais</h1>
        <p className="text-gray-500">Cadastro informativo da equipe do prestador (sem acesso ao portal).</p>
      </div>

      {isAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Prestador</label>
          <select
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="w-full md:w-96 border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
          >
            <option value="">Todos os prestadores (somente visualização)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name} {p.cnpj ? `(${p.cnpj})` : ''}</option>
            ))}
          </select>
          {!selectedProviderId && (
            <p className="text-xs text-gray-500 mt-2">Selecione um prestador para cadastrar novos contatos.</p>
          )}
        </div>
      )}

      {showCrossView ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          {loadingAll ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00995D]"></div>
            </div>
          ) : allContacts.length === 0 ? (
            <div className="text-center py-12">
              <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-1">Nenhum contato cadastrado</h3>
              <p className="text-gray-500">Selecione um prestador acima para cadastrar contatos.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-sm text-gray-500">
                    <th className="pb-3 font-medium">Nome</th>
                    <th className="pb-3 font-medium">Cargo/Função</th>
                    <th className="pb-3 font-medium">Registro Conselho</th>
                    <th className="pb-3 font-medium">Contato</th>
                    <th className="pb-3 font-medium">CPF</th>
                    <th className="pb-3 font-medium">Prestador</th>
                    <th className="pb-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {allContacts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 font-medium text-gray-800">{c.name}</td>
                      <td className="py-3 text-gray-600">{c.position || '-'}</td>
                      <td className="py-3 text-gray-600">{c.council_registry || '-'}</td>
                      <td className="py-3 text-gray-600">
                        <div className="flex flex-col gap-0.5">
                          {c.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-gray-400" />{c.email}</span>}
                          {c.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-gray-400" />{c.phone}</span>}
                          {!c.email && !c.phone && '-'}
                        </div>
                      </td>
                      <td className="py-3 text-gray-600 font-mono text-xs">{c.cpf || '-'}</td>
                      <td className="py-3 text-gray-600">{c.provider_name || '-'}</td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleDeleteFromCrossView(c.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remover contato"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <ProviderContactsPanel providerId={activeProviderId} hideProviderColumn canEdit />
      )}
    </div>
  );
}
