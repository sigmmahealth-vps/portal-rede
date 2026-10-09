import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchApi } from '../lib/api';

export default function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // Prestador com mais de uma unidade: a senha é de cada unidade, então ele escolhe de qual.
  const [units, setUnits] = useState<{ user_id: number; label: string }[] | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    let pickUnit = false;
    try {
      const r = await fetchApi('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ login: email, user_id: unitId ?? undefined }),
      });
      if (!units && Array.isArray(r?.units) && r.units.length > 1) {
        setUnits(r.units);
        pickUnit = true;
      }
    } catch { /* sempre 200, mas defensivo */ }
    setLoading(false);
    if (pickUnit) return;
    setSent(true);
    setTimeout(() => navigate('/login'), 8000);
  };

  return (
    <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-emerald-700 mb-2">Esqueceu sua senha?</h1>
        <p className="text-sm text-gray-500 mb-6">
          {units ? 'Cada unidade tem a própria senha. Escolha a unidade que precisa redefinir.' : 'Informe o CPF/CNPJ do prestador. Equipe Unimed: informe o seu e-mail.'}
        </p>

        {sent ? (
          <div className="bg-emerald-50 text-emerald-800 p-4 rounded-md text-sm">
            Pedido registrado. Se a unidade tiver e-mail cadastrado, o link para redefinir a senha chega a esse e-mail em alguns minutos (confira também o Spam). Caso contrário, a equipe da Unimed foi avisada e entrará em contato.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {units ? (
              <fieldset>
                <legend className="block text-sm font-medium text-gray-700 mb-2">Unidade</legend>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {units.map((u) => (
                    <label
                      key={u.user_id}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-sm cursor-pointer ${unitId === u.user_id ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                      <input type="radio" name="unit" required className="mt-1" checked={unitId === u.user_id} onChange={() => setUnitId(u.user_id)} />
                      <span className="font-medium text-gray-800">{u.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div>
                <label htmlFor="forgot-login" className="block text-sm font-medium text-gray-700 mb-1">CPF/CNPJ</label>
                <input
                  id="forgot-login"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}
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
