import React, { useState } from 'react';
import { X } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function NovoUsuarioModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'auditoria'>('auditoria');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await fetchApi('/users', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim(), role }) });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Falha ao criar usuário.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Novo usuário</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Função</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={role === 'auditoria'} onChange={() => setRole('auditoria')} />
                <span>Auditoria</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={role === 'admin'} onChange={() => setRole('admin')} />
                <span>Admin</span>
              </label>
            </div>
          </div>
          <p className="text-xs text-gray-500">O usuário receberá um e-mail com link para definir a senha (válido por 24 horas).</p>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-emerald-600 text-white rounded-md font-medium hover:bg-emerald-700 disabled:bg-gray-300">
              {submitting ? 'Criando...' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
