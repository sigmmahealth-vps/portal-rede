import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import {
  Play, Clock, LayoutGrid, ClipboardList, Target, Award, Smile, ArrowRight, Eye,
} from 'lucide-react';
import RoteiroPlayer from './RoteiroPlayer';

const TABS = [
  { key: 'inicio', label: 'Início', icon: LayoutGrid, soon: false },
  { key: 'roteiros', label: 'Meus Roteiros', icon: ClipboardList, soon: false },
  { key: 'planos', label: 'Planos de Ação', icon: Target, soon: true },
  { key: 'certificados', label: 'Certificados', icon: Award, soon: true },
  { key: 'pesquisa', label: 'Pesquisa de Satisfação', icon: Smile, soon: true },
] as const;

type TabKey = typeof TABS[number]['key'];

const OPEN_STATES = ['finalizado', 'aprovado', 'reprovado'];

function EmBreve({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-bold text-secondary-900">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">{desc}</p>
      <span className="mt-4 inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Em breve
      </span>
    </div>
  );
}

export default function PrestadorView({ user }: { user: any }) {
  const [scripts, setScripts] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('roteiros');
  const [activePlayer, setActivePlayer] = useState<{ scriptId: number, instanceId?: number, readOnly?: boolean } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [scriptsData, instancesData, providerData] = await Promise.all([
        fetchApi('/eval/scripts'),
        fetchApi('/eval/instances'),
        fetchApi('/me/provider').catch(() => null),
      ]);
      setScripts(scriptsData);
      setInstances(instancesData);
      setProviderName(providerData ? (providerData.trade_name || providerData.name) : null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (activePlayer) {
    return (
      <RoteiroPlayer
        scriptId={activePlayer.scriptId}
        instanceId={activePlayer.instanceId}
        readOnly={activePlayer.readOnly}
        providerId={user.provider_id}
        onClose={() => {
          setActivePlayer(null);
          loadData();
        }}
      />
    );
  }

  const scriptsVigentes = scripts.filter((s: any) => s.is_current !== false);
  const inProgress = instances.find(i => !OPEN_STATES.includes(i.status));
  const lastSealed = instances.find(i => i.status === 'finalizado' && i.seal);
  const displayName = providerName || (user?.name || '').split(' ')[0] || '';

  // Progresso de preenchimento (respondidos / total), não o score — que só existe pós-auditoria.
  const fillPct = (i: any) => {
    const total = Number(i?.total_questions) || 0;
    const answered = Number(i?.answered_count) || 0;
    return total > 0 ? Math.round((answered / total) * 100) : 0;
  };

  // --- Conteúdo por aba -------------------------------------------------------

  const inicioTab = (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-bold text-secondary-900">Olá{displayName ? `, ${displayName}` : ''}</h2>

        {inProgress ? (
          <>
            <p className="mt-1 text-sm text-gray-500">
              {inProgress.status === 'pendente'
                ? 'Sua qualificação foi enviada e está aguardando auditoria.'
                : 'Você tem uma qualificação em andamento.'}
            </p>
            <div className="mt-4 rounded-xl bg-emerald-50/60 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-secondary-900">{inProgress.script_title}</p>
                  <p className="text-sm font-medium text-emerald-700">
                    {fillPct(inProgress)}% respondido · {Number(inProgress.answered_count) || 0} de {Number(inProgress.total_questions) || 0} critérios
                  </p>
                </div>
                <button
                  onClick={() => setActivePlayer({ scriptId: inProgress.script_id, instanceId: inProgress.id, readOnly: inProgress.status === 'pendente' })}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600"
                >
                  {inProgress.status === 'pendente'
                    ? (<><Eye className="h-4 w-4" /> Visualizar avaliação</>)
                    : (<><Clock className="h-4 w-4" /> Continuar avaliação</>)}
                </button>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-emerald-100">
                <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out" style={{ width: `${fillPct(inProgress)}%` }} />
              </div>
            </div>
          </>
        ) : lastSealed ? (
          <>
            <p className="mt-1 text-sm text-gray-500">Sua qualificação mais recente está concluída.</p>
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-amber-50 p-4">
              <Award className="h-6 w-6 text-amber-500" />
              <p className="text-sm font-semibold text-amber-800">Selo {lastSealed.seal} — {lastSealed.script_title}</p>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-500">Você ainda não iniciou sua qualificação da RN 630.</p>
            <button
              onClick={() => setActiveTab('roteiros')}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600"
            >
              Ver meus roteiros <ArrowRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-bold text-secondary-900">Sobre a qualificação</h3>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">
          Os roteiros de avaliação técnica (RN 630) verificam as condições organizacionais, o atendimento
          ao cliente e o abastecimento e apoio do seu estabelecimento. Responda cada critério com evidências
          e acompanhe seu progresso na aba <span className="font-semibold text-secondary-900">Meus Roteiros</span>.
        </p>
      </div>
    </div>
  );

  const roteirosTab = (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="border-b pb-2 text-lg font-bold text-secondary-900">Roteiros Disponíveis</h2>
        {scriptsVigentes.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum roteiro disponível para o seu tipo de prestador.</p>
        ) : scriptsVigentes.map(s => {
          const existing = instances.find(i => i.script_id === s.id && !OPEN_STATES.includes(i.status));
          const sent = existing?.status === 'pendente'; // enviado — só visualização
          return (
            <div key={s.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <h3 className="font-bold text-secondary-900">{s.title}</h3>
              <p className="mt-1 text-sm text-gray-500">{s.description}</p>
              <button
                onClick={() => setActivePlayer({ scriptId: s.id, instanceId: existing?.id, readOnly: sent })}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                {sent
                  ? (<><Eye className="h-4 w-4" /> Visualizar Avaliação</>)
                  : existing
                    ? (<><Clock className="h-4 w-4" /> Continuar Avaliação</>)
                    : (<><Play className="h-4 w-4" /> Iniciar Avaliação</>)}
              </button>
            </div>
          );
        })}
      </div>

      <div className="space-y-4">
        <h2 className="border-b pb-2 text-lg font-bold text-secondary-900">Meu Histórico</h2>
        {instances.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum histórico encontrado.</p>
        ) : instances.map(inst => (
          <div key={inst.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-bold text-secondary-900">{inst.script_title}</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {inst.status === 'em_andamento'
                    ? `Iniciado em: ${new Date(inst.started_at).toLocaleDateString('pt-BR')}`
                    : `Enviado em: ${new Date(inst.completed_at || inst.started_at).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              {inst.status === 'finalizado' && inst.seal ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                  Selo {inst.seal}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">
                  {inst.status === 'pendente' ? 'Aguardando auditoria' : inst.status.replace('_', ' ')}
                </span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">{inst.status === 'finalizado' ? 'Score' : 'Progresso'}</span>
              <span className={(inst.status === 'finalizado' ? Number(inst.percentual) : fillPct(inst)) >= 80 ? 'text-emerald-600' : 'text-amber-600'}>
                {inst.status === 'finalizado' ? Number(inst.percentual).toFixed(0) : fillPct(inst)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Cabeçalho do módulo */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Qualificação da Rede</h1>
        <p className="text-gray-500">Gestão do ciclo de qualificação da rede credenciada Unimed Criciúma</p>
      </div>

      {/* Barra de abas */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
        {TABS.map(t => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                active ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Conteúdo da aba */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
        </div>
      ) : activeTab === 'inicio' ? (
        inicioTab
      ) : activeTab === 'roteiros' ? (
        roteirosTab
      ) : activeTab === 'planos' ? (
        <EmBreve icon={Target} title="Planos de Ação" desc="Aqui você acompanhará os planos de ação (5W2H) gerados a partir das não conformidades da sua qualificação." />
      ) : activeTab === 'certificados' ? (
        <EmBreve icon={Award} title="Certificados" desc="Seus certificados de qualificação e selos (Bronze, Prata, Ouro) ficarão disponíveis aqui após a conclusão da análise." />
      ) : (
        <EmBreve icon={Smile} title="Pesquisa de Satisfação" desc="Em breve você poderá responder e acompanhar as pesquisas de satisfação da rede credenciada." />
      )}
    </div>
  );
}
