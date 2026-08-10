import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { welcomeLine } from '../../lib/greeting';
import {
  Play, Clock, LayoutGrid, ClipboardList, Target, Award, Smile, ArrowRight, Eye, MapPin,
} from 'lucide-react';
import RoteiroPlayer from './RoteiroPlayer';
import MeuPlanoAcao from './MeuPlanoAcao';
import CertificadosTab from './CertificadosTab';
import { statusLabel } from '../../lib/statusLabels';

const TABS = [
  { key: 'inicio', label: 'Início', icon: LayoutGrid, soon: false },
  { key: 'roteiros', label: 'Meus Roteiros', icon: ClipboardList, soon: false },
  { key: 'planos', label: 'Planos de Ação', icon: Target, soon: false },
  { key: 'certificados', label: 'Certificados', icon: Award, soon: false },
  { key: 'pesquisa', label: 'Pesquisa de Satisfação', icon: Smile, soon: true },
] as const;

type TabKey = typeof TABS[number]['key'];

// Estados que consideramos "fechados" — a instância vira histórico (não é o
// trabalho corrente do prestador). ciclo_encerrado entra aqui: quando o auditor
// encerra o ciclo com instância não-terminal, ela vira histórico do prestador.
const OPEN_STATES = ['finalizado', 'aprovado', 'reprovado', 'ciclo_encerrado'];
// Estados em que o prestador ainda pode editar respostas e enviar para análise
// (POST /submit). Fora daqui (pendente/em_analise/terminais) a instância é só leitura.
const EDITABLE_STATES = ['pendente', 'em_andamento', 'aguardando_evidencia'];

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
  const [evalScriptId, setEvalScriptId] = useState<number | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('inicio');
  const [activePlayer, setActivePlayer] = useState<{ scriptId: number, instanceId?: number, locationId?: number, readOnly?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      setEvalScriptId(providerData?.eval_script_id ?? null);
      setLocations(providerData?.locations ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Envia a instância para análise (POST /submit) — usado tanto no envio inicial
  // quanto no reenvio após reanálise (status 'aguardando_evidencia').
  const submitForAnalysis = async (instanceId: number) => {
    if (!confirm('Enviar para análise? Você não poderá editar até o auditor liberar.')) return;
    setSubmitting(true);
    try {
      await fetchApi(`/eval/instances/${instanceId}/submit`, { method: 'POST' });
      alert('Enviado com sucesso!');
      await loadData();
    } catch (e: any) {
      if (e.message.includes('critérios sem resposta')) alert('Preencha todos os critérios antes de enviar.');
      else if (e.message.includes('aguardando reanálise')) alert('Ainda há critérios aguardando reanálise.');
      else alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (activePlayer) {
    return (
      <RoteiroPlayer
        scriptId={activePlayer.scriptId}
        instanceId={activePlayer.instanceId}
        locationId={activePlayer.locationId}
        readOnly={activePlayer.readOnly}
        providerId={user.provider_id}
        onClose={() => {
          setActivePlayer(null);
          loadData();
        }}
      />
    );
  }

  const scriptsVigentesRaw = scripts.filter((s: any) => s.is_current !== false);
  // Cada prestador vê apenas o roteiro que o import resolveu para ele
  // (providers.eval_script_id, populado a partir do provider_group).
  // Sem eval_script_id, cai para todos os vigentes (fallback defensivo).
  const scriptsVigentes = evalScriptId != null
    ? scriptsVigentesRaw.filter((s: any) => s.id === evalScriptId)
    : scriptsVigentesRaw;
  const inProgress = instances.find(i => !OPEN_STATES.includes(i.status));
  const lastSealed = instances.find(i => i.status === 'finalizado' && i.seal);
  const greeting = welcomeLine(user?.last_login_at);

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
        <h2 className="text-lg font-bold text-secondary-900">{greeting}</h2>

        {inProgress ? (
          <>
            <p className="mt-1 text-sm text-gray-500">
              {inProgress.status === 'pendente'
                ? 'Você tem uma nova qualificação disponível para preenchimento.'
                : EDITABLE_STATES.includes(inProgress.status)
                  ? 'Você tem uma qualificação em andamento.'
                  : 'Sua qualificação foi enviada e está aguardando auditoria.'}
            </p>
            <div className="mt-4 rounded-xl bg-emerald-50/60 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-secondary-900">{inProgress.script_title}</p>
                  <p className="text-sm font-medium text-emerald-700">
                    {fillPct(inProgress)}% respondido · {Number(inProgress.answered_count) || 0} de {Number(inProgress.total_questions) || 0} critérios
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setActivePlayer({ scriptId: inProgress.script_id, instanceId: inProgress.id, readOnly: !EDITABLE_STATES.includes(inProgress.status) })}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600"
                  >
                    {inProgress.status === 'pendente'
                      ? (<><Play className="h-4 w-4" /> Iniciar avaliação</>)
                      : EDITABLE_STATES.includes(inProgress.status)
                        ? (<><Clock className="h-4 w-4" /> Continuar avaliação</>)
                        : (<><Eye className="h-4 w-4" /> Visualizar avaliação</>)}
                  </button>
                  {EDITABLE_STATES.includes(inProgress.status) && (
                    <button
                      onClick={() => submitForAnalysis(inProgress.id)}
                      disabled={submitting}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500 px-4 py-2.5 text-sm font-bold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50 disabled:opacity-60"
                    >
                      {submitting ? 'Enviando...' : 'Enviar para Análise'}
                    </button>
                  )}
                </div>
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

  // Um par (script × unidade) é uma "linha" da aba Roteiros. Se houver >1 unidade
  // comercial, cada unidade tem sua própria instância; senão, comportamento antigo
  // (locationId undefined; o backend resolve auto quando há 1 unidade).
  const roteirosTab = (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="border-b pb-2 text-lg font-bold text-secondary-900">Roteiros Disponíveis</h2>
        {scriptsVigentes.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum roteiro disponível para o seu tipo de prestador.</p>
        ) : scriptsVigentes.map(s => {
          const hasMultiple = locations.length > 1;
          // Sem unidades ou só uma → 1 linha; múltiplas → 1 linha por unidade.
          const rows = hasMultiple
            ? locations.map((loc: any) => ({ loc, key: `${s.id}-${loc.id}` }))
            : [{ loc: null, key: `${s.id}` }];
          return rows.map(({ loc, key }) => {
            const existing = instances.find(i =>
              i.script_id === s.id
              && !OPEN_STATES.includes(i.status)
              && (loc ? String(i.location_id) === String(loc.id) : true),
            );
            // Sem instância corrente (admin não abriu ciclo pra esse local, ou o
            // ciclo já encerrou), o prestador não tem o que fazer — esconde o card.
            if (!existing) return null;
            const sent = !EDITABLE_STATES.includes(existing.status);
            const cityUf = loc && loc.cidade ? `${loc.cidade}${loc.uf ? '/' + String(loc.uf).toUpperCase() : ''}` : null;
            return (
              <div key={key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
                <h3 className="font-bold text-secondary-900">{s.title}</h3>
                {loc && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <MapPin className="h-3.5 w-3.5" />
                    {loc.label || 'Unidade'}{cityUf ? ` — ${cityUf}` : ''}
                  </p>
                )}
                {!loc && <p className="mt-1 text-sm text-gray-500">{s.description}</p>}
                <button
                  onClick={() => setActivePlayer({ scriptId: s.id, instanceId: existing.id, locationId: loc?.id, readOnly: sent })}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  {sent
                    ? (<><Eye className="h-4 w-4" /> Visualizar Avaliação</>)
                    : (<><Clock className="h-4 w-4" /> Continuar Avaliação</>)}
                </button>
              </div>
            );
          }).filter(Boolean);
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
                {inst.location_label && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <MapPin className="h-3 w-3" />
                    {inst.location_label}{inst.location_uf ? '/' + String(inst.location_uf).toUpperCase() : ''}
                  </p>
                )}
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
                  {statusLabel(inst.status)}
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
        <MeuPlanoAcao />
      ) : activeTab === 'certificados' ? (
        <CertificadosTab />
      ) : (
        <EmBreve icon={Smile} title="Pesquisa de Satisfação" desc="Em breve você poderá responder e acompanhar as pesquisas de satisfação da rede credenciada." />
      )}
    </div>
  );
}
