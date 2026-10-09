import React, { useEffect, useState } from 'react';
import { fetchApi, manualHref } from '../../lib/api';
import { fmtData, fmtPct } from '../../lib/formatDate';
import {
  Play, Clock, LayoutGrid, ClipboardList, Target, Award, Smile, ArrowRight, Eye, MapPin,
  AlertTriangle, ChevronDown, ChevronRight, CheckCircle2, FileText,
} from 'lucide-react';
import RoteiroPlayer from './RoteiroPlayer';
import MeuPlanoAcao from './MeuPlanoAcao';
import CertificadosTab from './CertificadosTab';
import PesquisaSatisfacao from './PesquisaSatisfacao';
import { statusLabel } from '../../lib/statusLabels';
import { displayStatus } from '../../lib/auditorDashboard';
import { buildInicioModel, type AlertType, type AlertItem } from '../../lib/inicioAlerts';

const TABS = [
  { key: 'inicio', label: 'Início', icon: LayoutGrid, soon: false },
  { key: 'roteiros', label: 'Meus Roteiros', icon: ClipboardList, soon: false },
  { key: 'planos', label: 'Planos de Ação', icon: Target, soon: false },
  { key: 'certificados', label: 'Certificados', icon: Award, soon: false },
  { key: 'pesquisa', label: 'Pesquisa de Satisfação', icon: Smile, soon: false },
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

// --- Mural de alertas (spec 2026-08-13) — escopo de módulo -------------------
// Identidade estável entre renders: fora do componente, não remonta (e não
// perde o estado `open` de cada card) quando PrestadorView re-renderiza.
const GROUP_META: Record<AlertType, { label: string; Icon: any; dot: string; card: string; btn: string }> = {
  corrigir:  { label: 'Corrigir e reenviar',      Icon: AlertTriangle, dot: 'bg-red-500',     card: 'border-red-200 bg-red-50/60',       btn: 'bg-red-500 hover:bg-red-600' },
  plano:     { label: 'Responder plano de ação',  Icon: Target,        dot: 'bg-orange-500',  card: 'border-orange-200 bg-orange-50/60', btn: 'bg-orange-500 hover:bg-orange-600' },
  continuar: { label: 'Continuar avaliação',      Icon: Clock,         dot: 'bg-amber-500',   card: 'border-amber-200 bg-amber-50/60',   btn: 'bg-amber-500 hover:bg-amber-600' },
  iniciar:   { label: 'Iniciar avaliação',        Icon: Play,          dot: 'bg-blue-500',    card: 'border-blue-200 bg-blue-50/60',     btn: 'bg-blue-500 hover:bg-blue-600' },
  pesquisa:  { label: 'Responder pesquisa (+10)', Icon: Smile,         dot: 'bg-emerald-500', card: 'border-emerald-200 bg-emerald-50/60', btn: 'bg-emerald-500 hover:bg-emerald-600' },
};

const itemBtnLabel = (type: AlertType): string =>
  type === 'corrigir' ? 'Corrigir' : type === 'plano' ? 'Responder' : type === 'pesquisa' ? 'Responder' : type === 'continuar' ? 'Continuar' : 'Iniciar';

// key? — sem @types/react neste projeto, JSX não infere LibraryManagedAttributes;
// o campo é só para o checker aceitar `key=` no map, React descarta em runtime.
const AlertGroupCard = ({ type, items, onRun, manualFor }: { key?: string; type: AlertType; items: AlertItem[]; onRun: (type: AlertType, it: AlertItem) => void; manualFor?: (scriptId?: number) => string | null }) => {
  const meta = GROUP_META[type];
  // Grupo com 1 item já vem expandido, sem colapso (spec §2).
  const [open, setOpen] = useState(items.length === 1);
  const single = items.length === 1;
  return (
    <div className={`rounded-2xl border ${meta.card}`}>
      <button
        type="button"
        onClick={() => !single && setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${meta.dot}`}>
          <meta.Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-bold text-secondary-900">{meta.label}</span>
          <span className="ml-2 text-sm font-medium text-gray-500">{items.length} roteiro{items.length > 1 ? 's' : ''}</span>
        </span>
        {!single && (open ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />)}
      </button>
      {open && (
        <ul className="space-y-2 px-4 pb-4">
          {items.map(it => (
            <li key={it.key} className="flex flex-col gap-2 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-secondary-900">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" /> {it.ref}
                </p>
                {it.detail && <p className="mt-0.5 text-xs font-medium text-gray-500">{it.detail}</p>}
                {it.deadline && <p className="mt-0.5 text-xs font-medium text-gray-500">até {fmtData(it.deadline)}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(() => {
                  const href = manualFor?.(it.scriptId);
                  return href && (
                    <a href={href} className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#F47920] bg-[#FDF0E3] px-3 py-1.5 text-sm font-bold text-[#8A3A06] shadow-sm hover:bg-[#FBE1C7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F47920]/40">
                      <FileText className="h-4 w-4" /> Baixar manual
                    </a>
                  );
                })()}
                <button
                  onClick={() => onRun(type, it)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors ${meta.btn}`}
                >
                  {itemBtnLabel(type)} <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default function PrestadorView({ user }: { user: any }) {
  const [scripts, setScripts] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [evalScriptId, setEvalScriptId] = useState<number | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // ?aba= vem do clique numa notificação (notifyLink); sem ele, abre no Início.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const p = new URLSearchParams(window.location.search).get('aba');
    return (TABS.find(t => t.key === p)?.key ?? 'inicio') as TabKey;
  });
  const [activePlayer, setActivePlayer] = useState<{ scriptId: number, instanceId?: number, locationId?: number, readOnly?: boolean, initialFilter?: 'reanalise' } | null>(null);

  const [survey, setSurvey] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const loadSurvey = async () => {
    try { setSurvey(await fetchApi('/me/survey')); } catch { setSurvey(null); }
  };

  const openNewCertificate = async (id: number) => {
    try { await fetchApi(`/me/certificates/${id}/seen`, { method: 'POST' }); } catch { /* segue mesmo assim */ }
    await loadData();
    setActiveTab('certificados');
  };

  useEffect(() => {
    loadData();
    loadSurvey();
  }, []);

  // ?corrigir=<instância> (notificação de reanálise): abre o roteiro direto na correção,
  // como o botão "Corrigir" do Início. Consome o parâmetro para não reabrir ao voltar.
  useEffect(() => {
    if (loading) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get('corrigir');
    if (!id) return;
    url.searchParams.delete('corrigir');
    window.history.replaceState({}, '', url.toString());
    const inst = instances.find(i => String(i.id) === id);
    if (inst && !OPEN_STATES.includes(inst.status)) {
      setActivePlayer({ scriptId: inst.script_id, instanceId: inst.id, locationId: inst.location_id ?? undefined, readOnly: false, initialFilter: 'reanalise' });
    }
  }, [loading, instances]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [scriptsData, instancesData, providerData, plansData, certsData] = await Promise.all([
        fetchApi('/eval/scripts'),
        fetchApi('/eval/instances'),
        fetchApi('/me/provider').catch(() => null),
        fetchApi('/me/action-plans').catch(() => []),
        fetchApi('/me/certificates').catch(() => []),
      ]);
      setScripts(scriptsData);
      setInstances(instancesData);
      setEvalScriptId(providerData?.eval_script_id ?? null);
      setLocations(providerData?.locations ?? []);
      setPlans(plansData ?? []);
      setCertificates(certsData ?? []);
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
        locationId={activePlayer.locationId}
        readOnly={activePlayer.readOnly}
        initialFilter={activePlayer.initialFilter}
        providerId={user.provider_id}
        onClose={(opts) => {
          setActivePlayer(null);
          loadData();
          loadSurvey();
          // Só leva à pesquisa no primeiro envio — reenvio não gera pesquisa nova.
          if (opts?.submitted && opts?.survey) setActiveTab('pesquisa');
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
  // Pesquisas pendentes no prazo (uma por endereço) — alimenta o lembrete.
  const pendingSurveys = (survey?.surveys ?? []).filter((s: any) => s.state === 'disponivel' && !s.expired);
  const nextSurveyDeadline = pendingSurveys.map((s: any) => s.deadline).sort()[0];

  // Progresso de preenchimento (respondidos / total), não o score — que só existe pós-auditoria.
  const fillPct = (i: any) => {
    const total = Number(i?.total_questions) || 0;
    const answered = Number(i?.answered_count) || 0;
    return total > 0 ? Math.round((answered / total) * 100) : 0;
  };

  // Rótulo/ícone do botão por estado + progresso: enviado → Visualizar; editável sem
  // nada respondido → Iniciar; editável com progresso → Continuar.
  const actionFor = (i: any) => {
    if (!EDITABLE_STATES.includes(i.status)) return { label: 'Visualizar avaliação', Icon: Eye };
    return fillPct(i) === 0
      ? { label: 'Iniciar avaliação', Icon: Play }
      : { label: 'Continuar avaliação', Icon: Clock };
  };
  const fmtDate = (d: any) => (d ? fmtData(d) : null);
  // "Unidade — Cidade/UF" a partir do que a instância já traz.
  const instLocation = (i: any) =>
    i.location_label
      ? `${i.location_label}${i.location_uf ? '/' + String(i.location_uf).toUpperCase() : ''}`
      : null;

  // --- Conteúdo por aba -------------------------------------------------------

  // --- Mural de alertas (spec 2026-08-13) ------------------------------------
  const model = buildInicioModel({ instances, surveys: survey?.surveys ?? [], plans, certificates });

  // Link do manual no Início: só para roteiro com manual enviado (pesquisa/plano não têm scriptId).
  const manualFor = (scriptId?: number) =>
    scriptId != null && scripts.some((s: any) => Number(s.id) === scriptId && s.manual_filename) ? manualHref(scriptId) : null;

  // Ação de cada item, por tipo de grupo.
  const runItem = (type: AlertType, it: AlertItem) => {
    if (type === 'pesquisa') { setActiveTab('pesquisa'); return; }
    if (type === 'plano') { setActiveTab('planos'); return; }
    // corrigir / continuar / iniciar → abre o player do roteiro.
    // "Corrigir" cai direto na aba Reanálise (pedido do cliente, 2026-09-11).
    setActivePlayer({
      scriptId: it.scriptId!, instanceId: it.instanceId, locationId: it.locationId ?? undefined,
      readOnly: false, initialFilter: type === 'corrigir' ? 'reanalise' : undefined,
    });
  };

  const inicioTab = (
    <div className="space-y-6">
      {/* Linha de resumo */}
      {model.pendingCount > 0 ? (
        <p className="text-lg font-bold text-secondary-900">
          Você tem {model.pendingCount} atividade{model.pendingCount > 1 ? 's' : ''} pendente{model.pendingCount > 1 ? 's' : ''}.
        </p>
      ) : model.newCertificates.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="flex items-center gap-2 text-lg font-bold text-secondary-900">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" /> Tudo em dia
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Nada precisa da sua atenção agora.{' '}
            <button onClick={() => setActiveTab('roteiros')} className="font-semibold text-emerald-700 hover:underline">
              Ver Meus Roteiros
            </button>
          </p>
        </div>
      )}

      {/* Grupos de alerta, na ordem de urgência do modelo */}
      {model.groups.map(g => <AlertGroupCard key={g.type} type={g.type} items={g.items} onRun={runItem} manualFor={manualFor} />)}

      {/* Bloco positivo: certificado novo (não conta em N; some após 1ª abertura) */}
      {model.newCertificates.map(c => (
        <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Award className="h-7 w-7 text-amber-500" />
            <div>
              <p className="font-bold text-amber-900">Novo certificado disponível</p>
              <p className="text-sm text-amber-800">Selo {c.seal}{c.locationLabel ? ` — ${c.locationLabel}` : ''}</p>
            </div>
          </div>
          <button
            onClick={() => openNewCertificate(c.id)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-600"
          >
            Ver certificado <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );

  // Um par (script × unidade) é uma "linha" da aba Roteiros. Se houver >1 unidade
  // comercial, cada unidade tem sua própria instância; senão, comportamento antigo
  // (locationId undefined; o backend resolve auto quando há 1 unidade).
  // Instância corrente do par (roteiro × unidade) — a que vira card em "Roteiros Disponíveis".
  const currentInstance = (scriptId: number, loc: any) => instances.find(i =>
    i.script_id === scriptId
    && !OPEN_STATES.includes(i.status)
    && (loc ? String(i.location_id) === String(loc.id) : true),
  );
  // O histórico não repete o que já está em "Disponíveis" (a avaliação reaberta/prorrogada
  // continua sendo a mesma instância — aparecer nos dois lados parecia uma versão nova).
  const shownIds = new Set(scriptsVigentes.flatMap(s =>
    (locations.length > 1 ? locations : [null]).map((loc: any) => currentInstance(s.id, loc)?.id).filter(Boolean)));
  const historyInstances = instances.filter(i => !shownIds.has(i.id));

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
            const existing = currentInstance(s.id, loc);
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
                    {loc.logradouro || loc.label || 'Unidade'}{cityUf ? ` — ${cityUf}` : ''}
                  </p>
                )}
                {!loc && <p className="mt-1 text-sm text-gray-500">{s.description}</p>}
                {(() => {
                  const act = actionFor(existing);
                  return (
                    <button
                      onClick={() => setActivePlayer({ scriptId: s.id, instanceId: existing.id, locationId: loc?.id, readOnly: sent })}
                      className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                    >
                      <act.Icon className="h-4 w-4" /> {act.label}
                    </button>
                  );
                })()}
                {s.manual_filename && (
                  <a
                    href={manualHref(s.id)}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-[#F47920] bg-[#FDF0E3] px-4 py-2.5 text-sm font-bold text-[#8A3A06] shadow-sm transition-colors hover:bg-[#FBE1C7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F47920]/40"
                  >
                    <FileText className="h-4 w-4" /> Baixar manual do roteiro
                  </a>
                )}
              </div>
            );
          }).filter(Boolean);
        })}
      </div>

      <div className="space-y-4">
        <h2 className="border-b pb-2 text-lg font-bold text-secondary-900">Meu Histórico</h2>
        {historyInstances.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum histórico encontrado.</p>
        ) : historyInstances.map(inst => (
          <div key={inst.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-bold text-secondary-900">{inst.script_title}</h3>
                {inst.cycle_label && (
                  <p className="mt-0.5 text-xs font-semibold text-secondary-900">Ciclo {inst.cycle_label}</p>
                )}
                {inst.location_label && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <MapPin className="h-3 w-3" />
                    {inst.location_label}{inst.location_uf ? '/' + String(inst.location_uf).toUpperCase() : ''}
                  </p>
                )}
                <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                  {inst.status === 'em_andamento' ? (
                    <p>Iniciado em: {fmtDate(inst.started_at)}</p>
                  ) : (
                    <>
                      {inst.submitted_at && <p>Enviado em: {fmtDate(inst.submitted_at)}</p>}
                      {OPEN_STATES.includes(inst.status) && inst.completed_at && (
                        <p>Concluído em: {fmtDate(inst.completed_at)}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
              {inst.status === 'finalizado' && inst.seal ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                  Selo {inst.seal}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">
                  {statusLabel(displayStatus(inst.status, inst.pending_count, inst.submitted_on_behalf ? null : inst.submitted_at, inst.has_survey_response, new Date(), 'prestador'))}
                </span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">{inst.status === 'finalizado' ? 'Score' : 'Progresso'}</span>
              <span className={(inst.status === 'finalizado' ? Number(inst.percentual) : fillPct(inst)) >= 80 ? 'text-emerald-600' : 'text-amber-600'}>
                {inst.status === 'finalizado' ? fmtPct(inst.percentual) : `${fillPct(inst)}%`}
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
      <nav aria-label="Abas da qualificação" className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
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
      </nav>

      {/* Lembrete de Pesquisa de Satisfação pendente (no prazo) */}
      {pendingSurveys.length > 0 && !['pesquisa', 'inicio'].includes(activeTab) && (
        <div className="flex flex-col gap-3 rounded-xl bg-amber-400 p-4 text-amber-950 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Smile className="mt-0.5 h-6 w-6 shrink-0" />
            <div>
              <p className="font-bold">
                {pendingSurveys.length > 1
                  ? `${pendingSurveys.length} Pesquisas de Satisfação pendentes — ganhe +10 pontos em cada`
                  : 'Responda à Pesquisa de Satisfação e ganhe +10 pontos'}
              </p>
              <p className="text-sm text-amber-900">
                Leva ~2 minutos por endereço. Disponível até{' '}
                {fmtData(nextSurveyDeadline) || nextSurveyDeadline}
                {' '}(7 dias após o envio do roteiro).
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('pesquisa')}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-800"
          >
            Responder agora <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

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
        <PesquisaSatisfacao />
      )}
    </div>
  );
}
