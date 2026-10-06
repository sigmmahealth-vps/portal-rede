import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchApi } from '../lib/api';

export default function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetchApi('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ login: email }) });
    } catch { /* sempre 200, mas defensivo */ }
    setSent(true);
    setLoading(false);
    setTimeout(() => navigate('/login'), 8000);
  };

  return (
    <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-emerald-700 mb-2">Esqueceu sua senha?</h1>
        <p className="text-sm text-gray-500 mb-6">Informe o CPF/CNPJ do prestador. Equipe Unimed: informe o seu e-mail.</p>

        {sent ? (
          <div className="bg-emerald-50 text-emerald-800 p-4 rounded-md text-sm">
            Pedido registrado. Se o prestador tiver um único local com e-mail cadastrado, o link para redefinir a senha chega a esse e-mail em alguns minutos (confira também o Spam). Nos demais casos, a equipe da Unimed foi avisada e entrará em contato.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CPF/CNPJ</label>
              <input
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 text-white p-3 rounded-md font-medium hover:bg-emerald-700 disabled:bg-gray-300"
            >
              {loading ? 'Enviando...' : 'Solicitar redefinição'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-emerald-700 hover:underline">← Voltar para o login</Link>
        </div>
      </div>
    </div>
  );
}
