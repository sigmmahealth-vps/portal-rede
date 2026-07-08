import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { History, LogIn, KeyRound, ShieldCheck, UserPlus, User } from 'lucide-react';

const ACTION_META: Record<string, { label: string; icon: any }> = {
  login: { label: 'Login no portal', icon: LogIn },
  password_reset_requested: { label: 'Redefinição de senha solicitada', icon: KeyRound },
  password_set: { label: 'Senha definida', icon: KeyRound },
  provider_access_created: { label: 'Acesso do prestador criado', icon: UserPlus },
  provider_access_updated: { label: 'Acesso do prestador atualizado', icon: ShieldCheck },
};

function labelFor(action: string | null): { label: string; icon: any } {
  if (!action) return ACTION_META.login;
  return ACTION_META[action] ?? { label: action, icon: History };
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
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <Icon className="h-4 w-4 text-gray-400" />
                      {label}
                      {!ok && <span className="text-xs font-normal text-red-600">(falha)</span>}
                    </p>
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
        Registra ações de acesso e credenciais do prestador. Sincronizações cadastrais do SGU ainda não são rastreadas
        individualmente por prestador.
      </p>
    </div>
  );
}
