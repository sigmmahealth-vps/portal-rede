import { useEffect, useState } from 'react';

interface LogRow { id: number; action: string | null; meta: any; success: boolean; created_at: string; }

const LABELS: Record<string, string> = {
  'null': 'Login',
  'password_reset_requested': 'Recuperação de senha solicitada',
  'password_set': 'Senha definida',
  'user_invited': 'Convite enviado',
  'user_role_changed': 'Papel alterado',
  'user_activated': 'Usuário ativado',
  'user_deactivated': 'Usuário desativado',
  'invite_resent': 'Convite reenviado',
  'data_retention_run': 'Expurgo de retenção',
};

export default function MeusDados() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me/access-logs', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setLogs(d.logs ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Meus dados de acesso</h1>
      <p className="text-gray-600 mb-6">
        Últimos eventos de acesso e administração vinculados à sua conta.
      </p>
      {loading ? (
        <p className="text-gray-500">Carregando…</p>
      ) : logs.length === 0 ? (
        <p className="text-gray-500">Nenhum evento registrado ainda.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Data</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Evento</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">OK?</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-gray-800">
                    {new Date(l.created_at).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {LABELS[l.action ?? 'null'] ?? l.action ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {l.success ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-red-600">✗</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
