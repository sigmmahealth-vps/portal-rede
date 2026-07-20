import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchApi } from '../../lib/api';
import { Users, Plus, Trash2, Pencil, MoreVertical, X, Mail, Phone, IdCard, Stethoscope } from 'lucide-react';

type ProviderContactsPanelProps = {
  providerId: number | string | null;
  hideProviderColumn?: boolean;
  canEdit?: boolean;
};

export default function ProviderContactsPanel({ providerId, hideProviderColumn = true, canEdit = true }: ProviderContactsPanelProps) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', position: '', council_registry: '', email: '', phone: '', cpf: '' });
  const [openMenu, setOpenMenu] = useState<{ id: number; top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const toggleMenu = (id: number, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openMenu?.id === id) { setOpenMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    // ancora à direita do botão, logo abaixo
    setOpenMenu({ id, top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [openMenu]);

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const loadContacts = async () => {
    if (!providerId) {
      setContacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchApi(`/provider-contacts?provider_id=${providerId}`);
      setContacts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => setForm({ name: '', position: '', council_registry: '', email: '', phone: '', cpf: '' });
  const closeModal = () => { setShowModal(false); setEditingId(null); resetForm(); };

  const startCreate = () => {
    setEditingId(null);
    resetForm();
    setShowModal(true);
  };

  const startEdit = (c: any) => {
    setEditingId(c.id);
    setForm({
      name: c.name ?? '',
      position: c.position ?? '',
      council_registry: c.council_registry ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      cpf: c.cpf ?? '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerId) return;
    setSaving(true);
    try {
      if (editingId != null) {
        await fetchApi(`/provider-contacts/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
      } else {
        await fetchApi('/provider-contacts', {
          method: 'POST',
          body: JSON.stringify({ ...form, provider_id: providerId }),
        });
      }
      closeModal();
      loadContacts();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar contato');
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

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <button
            onClick={startCreate}
            disabled={!providerId}
            className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-5 h-5" />
            <span>Novo Contato/Profissional</span>
          </button>
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
                  {!hideProviderColumn && <th className="pb-3 font-medium">Prestador</th>}
                  {canEdit && <th className="pb-3 font-medium text-right">Ações</th>}
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
                    {!hideProviderColumn && <td className="py-3 text-gray-600">{c.provider_name || '-'}</td>}
                    {canEdit && (
                      <td className="py-3 text-right">
                        <button
                          onClick={(e) => toggleMenu(c.id, e)}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                          title="Ações"
                          aria-label="Ações do contato"
                          aria-haspopup="menu"
                          aria-expanded={openMenu?.id === c.id}
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openMenu && (() => {
        const c = contacts.find((x) => x.id === openMenu.id);
        if (!c) return null;
        return createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: openMenu.top, right: openMenu.right, zIndex: 9999 }}
            className="w-40 rounded-lg border border-gray-100 bg-white py-1 shadow-lg"
          >
            <button
              role="menuitem"
              onClick={() => { setOpenMenu(null); startEdit(c); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Pencil className="w-4 h-4 text-gray-400" />
              Editar
            </button>
            <button
              role="menuitem"
              onClick={() => { setOpenMenu(null); handleDelete(c.id); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              Excluir
            </button>
          </div>,
          document.body,
        );
      })()}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">
                {editingId != null ? 'Editar Contato/Profissional' : 'Novo Contato/Profissional'}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
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
                  type="button" onClick={closeModal}
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
