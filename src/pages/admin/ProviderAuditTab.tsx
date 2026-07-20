import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import {
  History, LogIn, KeyRound, ShieldCheck, UserPlus, User, Pencil,
  FileText, CheckCircle, ClipboardCheck, ClipboardList, Activity,
  Megaphone, GraduationCap,
} from 'lucide-react';

const ACTION_META: Record<string, { label: string; icon: any }> = {
  login: { label: 'Login no portal', icon: LogIn },
  password_reset_requested: { label: 'Redefinição de senha solicitada', icon: KeyRound },
  password_set: { label: 'Senha definida', icon: KeyRound },
  user_invited: { label: 'Convite enviado ao usuário', icon: UserPlus },
  invite_resent: { label: 'Convite reenviado', icon: ShieldCheck },
  user_role_changed: { label: 'Papel do usuário alterado', icon: ShieldCheck },
  provider_access_created: { label: 'Acesso do prestador criado', icon: UserPlus },
  provider_access_updated: { label: 'Acesso do prestador atualizado', icon: ShieldCheck },
  provider_updated: { label: 'Cadastro do prestador atualizado', icon: Pencil },
  provider_contact_created: { label: 'Contato adicionado à equipe', icon: UserPlus },
  provider_contact_updated: { label: 'Contato da equipe atualizado', icon: Pencil },
  provider_contact_deleted: { label: 'Contato removido da equipe', icon: User },
  document_uploaded: { label: 'Documento enviado', icon: FileText },
  document_updated: { label: 'Documento substituído', icon: FileText },
  document_deleted: { label: 'Documento removido', icon: FileText },
  document_status_changed: { label: 'Status do documento alterado', icon: CheckCircle },
  training_targeted: { label: 'Treinamento direcionado ao prestador', icon: GraduationCap },
  announcement_targeted: { label: 'Comunicado direcionado ao prestador', icon: Megaphone },
  survey_submitted: { label: 'Pesquisa respondida', icon: ClipboardList },
  contract_created: { label: 'Contrato enviado', icon: FileText },
  contract_signed: { label: 'Contrato assinado', icon: CheckCircle },
  qualification_submitted: { label: 'Qualificação submetida', icon: ClipboardCheck },
  qualification_evaluated: { label: 'Qualificação avaliada', icon: CheckCircle },
  action_plan_created: { label: 'Plano de ação criado', icon: ClipboardCheck },
  action_plan_status_changed: { label: 'Status do plano de ação alterado', icon: CheckCircle },
  evaluation_created: { label: 'Auditoria iniciada', icon: Activity },
  evaluation_answered: { label: 'Auditoria respondida', icon: Activity },
  evaluation_status_changed: { label: 'Status da auditoria alterado', icon: CheckCircle },
};

function labelFor(action: string | null): { label: string; icon: any } {
  if (!action) return ACTION_META.login;
  return ACTION_META[action] ?? { label: action, icon: History };
}

// Legibiliza o meta.* como uma linha curta abaixo do título.
function detailFor(action: string | null, meta: any): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, any>;
  switch (action) {
    case 'document_uploaded':
    case 'document_updated':
      return [m.type, m.filename].filter(Boolean).join(' · ') || null;
    case 'document_deleted':
      return m.type || null;
    case 'document_status_changed':
      return [m.type, m.status && `→ ${m.status}`, m.rejection_reason && `motivo: ${m.rejection_reason}`]
        .filter(Boolean).join(' · ') || null;
    case 'training_targeted':
    case 'announcement_targeted':
    case 'contract_created':
    case 'action_plan_created':
      return m.title || null;
    case 'qualification_evaluated':
      return m.final_status ? `Resultado: ${m.final_status}` : null;
    case 'action_plan_status_changed':
      return m.status ? `→ ${m.status}` : null;
    case 'evaluation_answered':
      return [m.location_label && `Unidade ${m.location_label}`, m.answers_count != null && `${m.answers_count} resposta(s)`]
        .filter(Boolean).join(' · ') || null;
    case 'evaluation_status_changed':
      return [m.location_label && `Unidade ${m.location_label}`, m.status && `→ ${m.status}`, m.seal && `selo: ${m.seal}`]
        .filter(Boolean).join(' · ') || null;
    case 'evaluation_created':
      return m.location_label ? `Unidade ${m.location_label}` : null;
    case 'provider_updated':
      return m.field ? `Campo: ${m.field}` : null;
    case 'provider_contact_created':
    case 'provider_contact_updated':
      return [m.name, m.position].filter(Boolean).join(' — ') || null;
    default:
      return null;
  }
}

export default function ProviderAuditTab({ providerId }: { providerId: number | string }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchApi(`/providers/${providerId}/audit`)
      .then((d) => setEvents(d.events || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [providerId]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-[#00995D]" />
      </div>
    );
  }

  if (error) {
    return <p className="py-8 text-center text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      {events.length === 0 ? (
        <div className="py-12 text-center">
          <History className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-500">Nenhum registro de auditoria para este prestador ainda.</p>
        </div>
      ) : (
        <ol className="relative ml-1 space-y-5 border-l border-gray-200 pl-6">
          {events.map((ev) => {
            const { label, icon: Icon } = labelFor(ev.action);
            const detail = detailFor(ev.action, ev.meta);
            const ok = ev.success !== false;
            const actor = ev.actor_name || ev.actor_email || 'Sistema / SGU';
            return (
              <li key={ev.id} className="relative">
                <span
                  className={`absolute -left-[1.925rem] top-1 h-3 w-3 rounded-full ring-4 ring-white ${
                    ok ? 'bg-[#00995D]' : 'bg-red-500'
                  }`}
                />
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <Icon className="h-4 w-4 text-gray-400" />
                      {label}
                      {!ok && <span className="text-xs font-normal text-red-600">(falha)</span>}
                    </p>
                    {detail && (
                      <p className="mt-0.5 pl-6 text-xs text-gray-600 break-words">{detail}</p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                      <User className="h-3.5 w-3.5" />
                      {actor}
                    </p>
                  </div>
                  <time className="whitespace-nowrap text-xs text-gray-400">
                    {new Date(ev.created_at).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p className="border-t border-gray-100 pt-4 text-xs text-gray-400">
        Registra acesso/credenciais e alterações neste prestador (documentos, qualificações,
        auditorias, contratos, planos de ação, contatos, envios direcionados). Sincronizações
        cadastrais do SGU ainda não são rastreadas individualmente.
      </p>
    </div>
  );
}
