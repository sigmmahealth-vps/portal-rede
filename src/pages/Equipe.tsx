import React, { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { Users, Plus, Trash2, X, Mail, Phone, IdCard, Stethoscope } from 'lucide-react';

// WS5 — Cadastro de equipe do prestador (§5.2.3 Tela 3).
// Contatos informativos (sem login). Prestador/cooperado gerenciam a própria equipe;
// admin/auditoria escolhem um prestador para visualizar/cadastrar.
export default function Equipe() {
  const [user, setUser] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', position: '', council_registry: '', email: '', phone: '', cpf: '' });

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isAdmin && providers.length === 0) {
      fetchApi('/providers').then(setProviders).catch(console.error);
    }
    loadContacts();
  }, [user, selectedProviderId]);

  const loadContacts = async () => {
    setLoading(true);
    try {
      const qs = isAdmin && selectedProviderId ? `?provider_id=${selectedProviderId}` : '';
      const data = await fetchApi(`/provider-contacts${qs}`);
      setContacts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => setForm({ name: '', position: '', council_registry: '', email: '', phone: '', cpf: '' });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAdmin && !selectedProviderId) {
      alert('Selecione um prestador antes de cadastrar um contato.');
      return;
    }
    setSaving(true);
    try {
      await fetchApi('/provider-contacts', {
        method: 'POST',
        body: JSON.stringify(isAdmin ? { ...form, provider_id: selectedProviderId } : form),
      });
      setShowModal(false);
      resetForm();
      loadContacts();
    } catch (err: any) {
      alert(err.message || 'Erro ao cadastrar contato');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Remover este contato da equipe?')) return;
    try {
      await fetchApi(`/provider-contacts/${id}`, { method: 'DELETE' });
      loadContacts();
    } catch (err: any) {
      alert(err.message || 'Erro ao remover contato');
    }
  };

  const canAdd = !isAdmin || !!selectedProviderId;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Equipe / Profissionais</h1>
          <p className="text-gray-500">Cadastro informativo da equipe do prestador (sem acesso ao portal).</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={!canAdd}
          className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" />
          <span>Novo Contato/Profissional</span>
        </button>
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00995D]"></div>
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-12">
            <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Nenhum contato cadastrado</h3>
            <p className="text-gray-500">Adicione os profissionais e contatos da equipe usando o botão acima.</p>
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
                  {isAdmin && !selectedProviderId && <th className="pb-3 font-medium">Prestador</th>}
                  <th className="pb-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {contacts.map((c) => (
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
                    {isAdmin && !selectedProviderId && <td className="py-3 text-gray-600">{c.provider_name || '-'}</td>}
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handleDelete(c.id)}
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

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Novo Contato/Profissional</h3>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome <span className="text-red-500">*</span></label>
                <input
                  type="text" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cargo/Função</label>
                  <div className="relative">
                    <Stethoscope className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text" value={form.position}
                      onChange={(e) => setForm({ ...form, position: e.target.value })}
                      placeholder="Ex: Médico, Recepção"
                      className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 pl-8"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Registro do Conselho</label>
                  <div className="relative">
                    <IdCard className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text" value={form.council_registry}
                      onChange={(e) => setForm({ ...form, council_registry: e.target.value })}
                      placeholder="Ex: CRM/SC 12345"
                      className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 pl-8"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                  <input
                    type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                  <input
                    type="text" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
                <input
                  type="text" value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button" onClick={() => { setShowModal(false); resetForm(); }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={saving}
                  className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
