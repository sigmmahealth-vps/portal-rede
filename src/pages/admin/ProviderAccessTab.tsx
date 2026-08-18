import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { ShieldCheck, Mail, Lock, Clock, Save, Send, AlertCircle, CheckCircle2 } from 'lucide-react';

function currentRole(): string | null {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').role ?? null;
  } catch {
    return null;
  }
}

export default function ProviderAccessTab({ providerId }: { providerId: number | string }) {
  const canEdit = currentRole() === 'admin';
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchApi(`/providers/${providerId}/access`)
      .then((d) => {
        setAccess(d);
        setEmail(d.user?.email || d.suggested_email || '');
      })
      .catch((e) => setFeedback({ type: 'err', msg: e.message }))
      .finally(() => setLoading(false));
  }, [providerId]);

  const exists = !!access?.exists;
  const user = access?.user;

  const submitAccess = async (withPassword: boolean) => {
    if (!email.trim()) {
      setFeedback({ type: 'err', msg: 'Informe o e-mail de acesso.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const d = await fetchApi(`/providers/${providerId}/access`, {
        method: 'POST',
        body: JSON.stringify({ email, password: withPassword && password ? password : undefined }),
      });
      setAccess(d);
      setPassword('');
      setFeedback({
        type: 'ok',
        msg: exists ? 'Credenciais atualizadas.'
          : withPassword ? 'Acesso criado com sucesso.'
          : 'Acesso criado — convite enviado ao prestador.',
      });
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  const resendInvite = async () => {
    if (!user?.id) return;
    setSendingReset(true);
    setFeedback(null);
    try {
      await fetchApi(`/users/${user.id}/resend-invite`, { method: 'POST' });
      setFeedback({ type: 'ok', msg: 'Convite reenviado ao prestador.' });
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSendingReset(false);
    }
  };

  const sendReset = async () => {
    setSendingReset(true);
    setFeedback(null);
    try {
      await fetchApi(`/providers/${providerId}/access/send-reset`, { method: 'POST' });
      setFeedback({ type: 'ok', msg: 'E-mail de redefinição de senha enviado ao prestador.' });
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSendingReset(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-[#00995D]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <ShieldCheck className="h-5 w-5 shrink-0 text-blue-600" />
        <p className="text-sm leading-relaxed text-blue-900">
          <span className="font-semibold">Acesso único:</span> cada prestador possui um único acesso ao portal, com
          visão restrita aos próprios dados, garantindo privacidade e aderência à LGPD. O perfil padrão é{' '}
          <span className="font-semibold">Prestador / Cooperado</span>.
        </p>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            feedback.type === 'ok'
              ? 'border-green-100 bg-green-50 text-green-800'
              : 'border-red-100 bg-red-50 text-red-700'
          }`}
        >
          {feedback.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {feedback.msg}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <form onSubmit={(e) => { e.preventDefault(); submitAccess(true); }} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">E-mail de acesso</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                disabled={!canEdit}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@prestador.com.br"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#00995D] focus:outline-none focus:ring-2 focus:ring-[#00995D]/20 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{exists ? 'Nova senha' : 'Senha'}</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={password}
                disabled={!canEdit}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder={exists ? 'Deixe em branco para não alterar' : 'Mínimo 8 caracteres'}
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#00995D] focus:outline-none focus:ring-2 focus:ring-[#00995D]/20 disabled:bg-gray-50"
              />
            </div>
            {exists && <p className="mt-1 text-xs text-gray-400">A senha atual permanece se o campo ficar vazio.</p>}
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {!exists && (
                <button
                  type="button"
                  onClick={() => submitAccess(false)}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[#00995D] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#007A4A] disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {saving ? 'Enviando...' : 'Criar acesso e enviar convite'}
                </button>
              )}
              <button
                type="submit"
                disabled={saving || (!exists && !password)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  exists ? 'bg-[#00995D] text-white hover:bg-[#007A4A]' : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : exists ? 'Salvar credenciais' : 'Criar com senha manual'}
              </button>
              {exists && user?.invite_status === 'pending' && (
                <button
                  type="button"
                  onClick={resendInvite}
                  disabled={sendingReset}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {sendingReset ? 'Enviando...' : 'Reenviar convite'}
                </button>
              )}
              {exists && user?.invite_status !== 'pending' && (
                <button type="button" onClick={sendReset} disabled={sendingReset}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50">
                  <Send className="h-4 w-4" />
                  {sendingReset ? 'Enviando...' : 'Enviar redefinição por e-mail'}
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Somente administradores podem alterar o acesso do prestador.</p>
          )}
        </form>

        <div className="h-fit rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-semibold">Último acesso</span>
          </div>
          {exists && user?.last_login_at ? (
            <dl className="mt-3 space-y-2.5 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Data</dt>
                <dd className="text-gray-800">{new Date(user.last_login_at).toLocaleString('pt-BR')}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">IP</dt>
                <dd className="font-mono text-xs text-gray-800">{user.last_login_ip || '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              {exists ? 'Nenhum acesso registrado ainda.' : 'Acesso ainda não cadastrado para este prestador.'}
            </p>
          )}
          {exists && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  user?.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {user?.is_active ? 'Acesso ativo' : 'Acesso inativo'}
              </span>
              {user?.invite_status === 'pending' && (
                <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  Convite pendente
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
