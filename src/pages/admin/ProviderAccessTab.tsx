import { useEffect, useState, type FormEvent } from 'react';
import { fetchApi } from '../../lib/api';
import PasswordInput from '../../components/PasswordInput';
import { ShieldCheck, Mail, Lock, Clock, Save, AlertCircle, CheckCircle2, MapPin, Eraser } from 'lucide-react';

function currentRole(): string | null {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').role ?? null;
  } catch {
    return null;
  }
}

interface Unit {
  location_id: number;
  label: string | null;
  logradouro: string | null;
  cidade: string | null;
  uf: string | null;
  sgu_location_code: string | null;
  suggested_email: string | null;
  user: any | null;
}

type Feedback = { type: 'ok' | 'err'; msg: string } | null;

// Nome da unidade = logradouro (mesma definição da Qualificação/tabela Rede),
// com fallback p/ o label ("COMERCIAL X") e a cidade.
const unitTitle = (u: Unit) =>
  [u.logradouro || u.label, u.cidade && u.uf ? `${u.cidade}/${u.uf}` : u.cidade].filter(Boolean).join(' — ') || `Unidade ${u.location_id}`;

function FeedbackBox({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        feedback.type === 'ok' ? 'border-green-100 bg-green-50 text-green-800' : 'border-red-100 bg-red-50 text-red-700'
      }`}
    >
      {feedback.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {feedback.msg}
    </div>
  );
}

export default function ProviderAccessTab({ providerId }: { providerId: number | string }) {
  const canEdit = currentRole() === 'admin';
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<Unit[]>([]);
  const [hasPassword, setHasPassword] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = () => {
    fetchApi(`/providers/${providerId}/access`)
      .then((d) => {
        setUnits(d.units ?? []);
        setHasPassword(!!d.has_password);
        setMustChange(!!d.must_change_password);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [providerId]);

  const setProvisionalPassword = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await fetchApi(`/providers/${providerId}/access/password`, { method: 'POST', body: JSON.stringify({ password }) });
      setPassword('');
      setFeedback({ type: 'ok', msg: 'Senha provisória definida. Entregue-a ao prestador: ele troca no primeiro acesso.' });
      load();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSaving(false);
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
          <span className="font-semibold">Login por CPF/CNPJ, com uma senha por prestador.</span> Depois da senha, o prestador
          escolhe a unidade e recebe o código de verificação no e-mail dela. Cada unidade cadastra o próprio e-mail no
          primeiro acesso — o mesmo responsável pode usar um único e-mail em todas — e só enxerga as avaliações, planos e
          certificados daquela unidade.
        </p>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" /> {loadError}
        </div>
      )}

      {units.length === 0 && !loadError && (
        <p className="text-sm text-gray-500">Este prestador não tem endereço comercial no cadastro.</p>
      )}

      {units.length > 0 && (
        <div className="rounded-xl border border-gray-100 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Lock className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-800">Senha do prestador</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              !hasPassword ? 'bg-gray-100 text-gray-600' : mustChange ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
            }`}>
              {!hasPassword ? 'Sem senha' : mustChange ? 'Provisória — aguardando o primeiro acesso' : 'Definida pelo prestador'}
            </span>
          </div>
          <FeedbackBox feedback={feedback} />
          {canEdit ? (
            <form onSubmit={setProvisionalPassword} className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <label htmlFor="provisional-password" className="mb-1 block text-sm font-medium text-gray-700">Nova senha provisória</label>
                <PasswordInput
                  id="provisional-password"
                  value={password}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#00995D] focus:outline-none focus:ring-2 focus:ring-[#00995D]/20"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#00995D] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#007A4A] disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Definir senha provisória'}
              </button>
              <p className="w-full text-xs text-gray-500">
                Vale para todas as unidades e encerra as sessões abertas. O prestador é obrigado a trocá-la no primeiro acesso.
                Use também quando ele esquecer a senha.
              </p>
            </form>
          ) : (
            <p className="text-xs text-gray-500">Somente administradores podem definir a senha do prestador.</p>
          )}
        </div>
      )}

      {units.map((unit) => (
        <UnitAccess
          key={`${unit.location_id}:${unit.user?.id ?? 'none'}:${unit.user?.email ?? ''}`}
          providerId={providerId}
          unit={unit}
          canEdit={canEdit}
          onChanged={load}
        />
      ))}
    </div>
  );
}

function UnitAccess({ providerId, unit, canEdit, onChanged }: {
  key?: string | number; // mesma convenção do AlertGroupCard: os tipos de JSX daqui exigem key no shape
  providerId: number | string; unit: Unit; canEdit: boolean; onChanged: () => void;
}) {
  const user = unit.user;
  const confirmed = !!user?.email && user?.invite_status === 'accepted';
  const [email, setEmail] = useState(user?.email || unit.suggested_email || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const saveEmail = async (value: string) => {
    setSaving(true);
    setFeedback(null);
    try {
      await fetchApi(`/providers/${providerId}/access`, {
        method: 'POST',
        body: JSON.stringify({ location_id: unit.location_id, email: value }),
      });
      setFeedback({
        type: 'ok',
        msg: value ? 'E-mail da unidade atualizado.' : 'E-mail removido — a unidade cadastra um novo no próximo acesso.',
      });
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <MapPin className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-800">{unitTitle(unit)}</span>
        {unit.sgu_location_code && <span className="text-xs text-gray-400">{unit.sgu_location_code}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confirmed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {confirmed ? 'E-mail confirmado' : 'Aguardando o primeiro acesso'}
        </span>
        {user && !user.is_active && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Acesso inativo</span>
        )}
      </div>

      <FeedbackBox feedback={feedback} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <form onSubmit={(e) => { e.preventDefault(); saveEmail(email.trim()); }} className="space-y-4">
          <div>
            <label htmlFor={`unit-email-${unit.location_id}`} className="mb-1 block text-sm font-medium text-gray-700">E-mail da unidade</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                id={`unit-email-${unit.location_id}`}
                type="email"
                required
                value={email}
                disabled={!canEdit}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@prestador.com.br"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#00995D] focus:outline-none focus:ring-2 focus:ring-[#00995D]/20 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {confirmed
                ? 'Recebe o código de verificação e os avisos desta unidade.'
                : 'A unidade cadastra e confirma o e-mail no primeiro acesso. Você também pode defini-lo aqui.'}
            </p>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#00995D] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#007A4A] disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar e-mail'}
              </button>
              {user?.email && (
                <button
                  type="button"
                  onClick={() => saveEmail('')}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  <Eraser className="h-4 w-4" />
                  Remover e-mail
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
          {user?.last_login_at ? (
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
            <p className="mt-2 text-sm text-gray-500">Nenhum acesso registrado ainda.</p>
          )}
        </div>
      </div>
    </div>
  );
}
