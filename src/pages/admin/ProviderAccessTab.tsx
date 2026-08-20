import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import PasswordInput from '../../components/PasswordInput';
import { ShieldCheck, Mail, Lock, Clock, Save, Send, AlertCircle, CheckCircle2, MapPin, Users, Split } from 'lucide-react';

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

// Nome da unidade = logradouro (mesma definição da Qualificação/tabela Rede),
// com fallback p/ o label ("COMERCIAL X") e a cidade.
const unitTitle = (u: Unit) =>
  [u.logradouro || u.label, u.cidade && u.uf ? `${u.cidade}/${u.uf}` : u.cidade].filter(Boolean).join(' — ') || `Unidade ${u.location_id}`;

export default function ProviderAccessTab({ providerId }: { providerId: number | string }) {
  const canEdit = currentRole() === 'admin';
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<Unit[]>([]);
  const [orphans, setOrphans] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupTarget, setGroupTarget] = useState<number | ''>('');
  const [grouping, setGrouping] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState(false); // liga a seleção múltipla p/ agrupar

  const load = () => {
    setLoading(true);
    fetchApi(`/providers/${providerId}/access`)
      .then((d) => {
        setUnits(d.units ?? []);
        setOrphans(d.orphans ?? []);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [providerId]);

  // Unidades agrupadas: mesmo user.id em >=2 cards significa 1 login cobrindo várias unidades.
  const groupLocationIds = new Map<number, number[]>();
  units.forEach((u) => {
    if (!u.user?.id) return;
    groupLocationIds.set(u.user.id, [...(groupLocationIds.get(u.user.id) ?? []), u.location_id]);
  });

  const toggleSelect = (locationId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(locationId) ? next.delete(locationId) : next.add(locationId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setGroupTarget('');
    setGroupError(null);
  };

  const selectedUnits = units.filter((u) => selected.has(u.location_id));
  // Destino do agrupamento só pode ser um login que já tem e-mail definido.
  const targetCandidates = Array.from(
    new Map(selectedUnits.filter((u) => u.user?.email).map((u) => [u.user.id, u.user])).values(),
  );

  const groupSelected = async () => {
    if (!groupTarget || selected.size < 2) return;
    setGrouping(true);
    setGroupError(null);
    try {
      await fetchApi(`/providers/${providerId}/access/group`, {
        method: 'POST',
        body: JSON.stringify({ target_user_id: groupTarget, location_ids: Array.from(selected) }),
      });
      clearSelection();
      load();
    } catch (err: any) {
      setGroupError(err.message);
    } finally {
      setGrouping(false);
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
          <span className="font-semibold">Um acesso por unidade (padrão):</span> cada endereço comercial tem seu próprio login,
          com visão restrita às avaliações, planos e certificados daquela unidade — privacidade e aderência à LGPD.
          Perfil padrão: <span className="font-semibold">Prestador / Cooperado</span>.{' '}
          <span className="font-semibold">Precisa centralizar?</span> Quando o mesmo responsável cuida de várias unidades,
          você pode <span className="font-semibold">agrupar</span> unidades sob um único acesso (um e-mail só).
        </p>
      </div>

      {canEdit && units.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-500">
            {groupMode
              ? 'Marque 2 ou mais unidades e escolha o acesso que as centraliza.'
              : `${units.length} unidade${units.length > 1 ? 's' : ''} de atendimento`}
          </p>
          {!groupMode ? (
            <button
              type="button"
              onClick={() => setGroupMode(true)}
              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <Users className="h-4 w-4" /> Agrupar unidades
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setGroupMode(false); clearSelection(); }}
              className="text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Sair do modo agrupar
            </button>
          )}
        </div>
      )}

      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" /> {loadError}
        </div>
      )}

      {units.length === 0 && !loadError && (
        <p className="text-sm text-gray-500">Este prestador não tem endereço comercial no cadastro.</p>
      )}

      {canEdit && groupMode && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <span className="text-sm font-medium text-emerald-900">
            {selected.size} unidade{selected.size > 1 ? 's' : ''} selecionada{selected.size > 1 ? 's' : ''}
          </span>
          <select
            aria-label="Acesso destino"
            value={groupTarget}
            onChange={(e) => setGroupTarget(e.target.value ? Number(e.target.value) : '')}
            className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-gray-800 focus:border-[#00995D] focus:outline-none focus:ring-2 focus:ring-[#00995D]/20"
          >
            <option value="">Acesso destino…</option>
            {targetCandidates.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name || u.email} ({u.email})</option>
            ))}
          </select>
          <button
            type="button"
            onClick={groupSelected}
            disabled={!groupTarget || grouping || selected.size < 2}
            className="flex items-center gap-2 rounded-lg bg-[#00995D] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#007A4A] disabled:opacity-50"
          >
            <Users className="h-4 w-4" />
            {grouping ? 'Agrupando...' : 'Agrupar em um acesso'}
          </button>
          <button type="button" onClick={clearSelection} className="text-sm font-medium text-emerald-800 hover:underline">
            Cancelar
          </button>
          {targetCandidates.length === 0 && (
            <span className="text-xs text-amber-800">
              Nenhuma unidade selecionada tem acesso com e-mail definido — defina um e-mail antes de agrupar.
            </span>
          )}
          {groupError && <span className="text-xs text-red-700">{groupError}</span>}
        </div>
      )}

      {units.map((unit) => (
        <UnitAccess
          key={`${unit.location_id}:${unit.user?.id ?? 'none'}`}
          providerId={providerId}
          unit={unit}
          canEdit={canEdit}
          onChanged={load}
          selected={selected.has(unit.location_id)}
          groupMode={groupMode}
          onToggleSelect={() => toggleSelect(unit.location_id)}
          groupLocationIds={unit.user?.id ? (groupLocationIds.get(unit.user.id) ?? [unit.location_id]) : [unit.location_id]}
        />
      ))}

      {orphans.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Acessos sem unidade</p>
          <p className="mt-1 text-xs text-amber-800">
            Vínculo perdido numa recarga de cadastro. Enquanto não forem re-vinculados, enxergam todas as unidades do prestador.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {orphans.map((o) => (
              <li key={o.id}>{o.email || 'sem e-mail'} <span className="text-xs text-amber-700">({o.role})</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UnitAccess({ providerId, unit, canEdit, onChanged, selected, groupMode, onToggleSelect, groupLocationIds }: {
  key?: string | number; // mesma convenção do AlertGroupCard: os tipos de JSX daqui exigem key no shape
  providerId: number | string; unit: Unit; canEdit: boolean; onChanged: () => void;
  selected: boolean; groupMode: boolean; onToggleSelect: () => void; groupLocationIds: number[];
}) {
  const user = unit.user;
  const exists = !!user;
  const isGrouped = groupLocationIds.length > 1;
  const [email, setEmail] = useState(user?.email || unit.suggested_email || '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [ungrouping, setUngrouping] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const submitAccess = async (withPassword: boolean) => {
    if (!email.trim()) {
      setFeedback({ type: 'err', msg: 'Informe o e-mail de acesso.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await fetchApi(`/providers/${providerId}/access`, {
        method: 'POST',
        body: JSON.stringify({
          location_id: unit.location_id,
          email,
          password: withPassword && password ? password : undefined,
        }),
      });
      setPassword('');
      setFeedback({
        type: 'ok',
        msg: exists ? 'Credenciais atualizadas.'
          : withPassword ? 'Acesso criado com sucesso.'
          : 'Acesso criado — convite enviado ao prestador.',
      });
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  const resendInvite = async () => {
    if (!user?.id) return;
    setSending(true);
    setFeedback(null);
    try {
      await fetchApi(`/users/${user.id}/resend-invite`, { method: 'POST' });
      setFeedback({ type: 'ok', msg: 'Convite reenviado ao prestador.' });
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSending(false);
    }
  };

  const sendReset = async () => {
    setSending(true);
    setFeedback(null);
    try {
      await fetchApi(`/providers/${providerId}/access/send-reset`, {
        method: 'POST',
        body: JSON.stringify({ location_id: unit.location_id }),
      });
      setFeedback({ type: 'ok', msg: 'E-mail de redefinição de senha enviado ao prestador.' });
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setSending(false);
    }
  };

  const ungroup = async () => {
    setUngrouping(true);
    setFeedback(null);
    try {
      await fetchApi(`/providers/${providerId}/access/ungroup`, {
        method: 'POST',
        body: JSON.stringify({ location_ids: groupLocationIds }),
      });
      setFeedback({ type: 'ok', msg: 'Unidades desagrupadas — 1 acesso por unidade recriado.' });
      onChanged();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message });
    } finally {
      setUngrouping(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canEdit && groupMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Selecionar ${unitTitle(unit)}`}
            className="h-4 w-4 rounded border-gray-300 text-[#00995D] focus:ring-2 focus:ring-[#00995D]/30"
          />
        )}
        <MapPin className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-800">{unitTitle(unit)}</span>
        {unit.sgu_location_code && <span className="text-xs text-gray-400">{unit.sgu_location_code}</span>}
        {!exists && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Sem acesso</span>
        )}
        {isGrouped && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            <Users className="h-3 w-3" /> Agrupado — {groupLocationIds.length} unidades
          </span>
        )}
      </div>

      {feedback && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
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
              <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <PasswordInput
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
                  disabled={sending}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {sending ? 'Enviando...' : 'Reenviar convite'}
                </button>
              )}
              {exists && user?.invite_status !== 'pending' && (
                <button type="button" onClick={sendReset} disabled={sending}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50">
                  <Send className="h-4 w-4" />
                  {sending ? 'Enviando...' : 'Enviar redefinição por e-mail'}
                </button>
              )}
              {isGrouped && (
                <button type="button" onClick={ungroup} disabled={ungrouping}
                  className="flex items-center gap-2 rounded-lg border border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:opacity-50">
                  <Split className="h-4 w-4" />
                  {ungrouping ? 'Desagrupando...' : 'Desagrupar'}
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
              {exists ? 'Nenhum acesso registrado ainda.' : 'Acesso ainda não cadastrado para esta unidade.'}
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
              {!user?.email && (
                <span className="ml-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  Sem e-mail
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
