import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchApi } from '../lib/api';

interface TokenInfo {
  valid: boolean;
  kind?: 'invite' | 'reset';
  name?: string;
  reason?: 'expired' | 'consumed' | 'unknown';
}

const checks = (pw: string) => ({
  length: pw.length >= 10,
  upper: /\p{Lu}/u.test(pw),
  lower: /\p{Ll}/u.test(pw),
  digit: /\d/.test(pw),
  symbol: /[^\p{L}\d\s]/u.test(pw),
});

export default function DefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchApi(`/auth/validate-setup-token?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setInfo({ valid: false, reason: 'unknown' }));
  }, [token]);

  const c = checks(pw);
  const allOk = c.length && c.upper && c.lower && c.digit && c.symbol && pw === pw2;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pw !== pw2) return setError('As senhas não coincidem.');
    setSubmitting(true);
    try {
      await fetchApi('/auth/redeem-token', { method: 'POST', body: JSON.stringify({ token, new_password: pw }) });
      navigate('/login?message=password_set');
    } catch (err: any) {
      setError(err.message ?? 'Falha ao definir senha.');
      setSubmitting(false);
    }
  };

  if (info === null) {
    return <div className="min-h-screen bg-emerald-50 flex items-center justify-center"><p className="text-gray-500">Validando link...</p></div>;
  }

  if (!info.valid) {
    const reasonMsg = info.reason === 'expired' ? 'Este link expirou.'
      : info.reason === 'consumed' ? 'Este link já foi utilizado.'
      : 'Link inválido.';
    return (
      <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-red-600 mb-3">{reasonMsg}</h1>
          <p className="text-sm text-gray-500 mb-6">Solicite um novo link para continuar.</p>
          <Link to="/esqueci-senha" className="inline-block bg-emerald-600 text-white px-6 py-3 rounded-md font-medium hover:bg-emerald-700">Solicitar novo link</Link>
        </div>
      </div>
    );
  }

  const isInvite = info.kind === 'invite';
  return (
    <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-emerald-700 mb-2">
          {isInvite ? `Bem-vindo, ${info.name}!` : 'Redefinir senha'}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {isInvite ? 'Defina sua senha para acessar o Portal Unimed.' : 'Escolha sua nova senha.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar senha</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <ul className="text-xs space-y-1">
            <li className={c.length ? 'text-emerald-700' : 'text-gray-400'}>{c.length ? '✓' : '○'} Mínimo 10 caracteres</li>
            <li className={c.upper ? 'text-emerald-700' : 'text-gray-400'}>{c.upper ? '✓' : '○'} Pelo menos 1 letra maiúscula</li>
            <li className={c.lower ? 'text-emerald-700' : 'text-gray-400'}>{c.lower ? '✓' : '○'} Pelo menos 1 letra minúscula</li>
            <li className={c.digit ? 'text-emerald-700' : 'text-gray-400'}>{c.digit ? '✓' : '○'} Pelo menos 1 número</li>
            <li className={c.symbol ? 'text-emerald-700' : 'text-gray-400'}>{c.symbol ? '✓' : '○'} Pelo menos 1 símbolo (!@#$%)</li>
          </ul>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}
          <button type="submit" disabled={!allOk || submitting}
            className="w-full bg-emerald-600 text-white p-3 rounded-md font-medium hover:bg-emerald-700 disabled:bg-gray-300">
            {submitting ? 'Salvando...' : (isInvite ? 'Definir senha' : 'Redefinir senha')}
          </button>
        </form>
      </div>
    </div>
  );
}
