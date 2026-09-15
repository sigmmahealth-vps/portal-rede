import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { fmtPct } from '../../lib/formatDate';
import { Search, Download, Eye, Undo2, Award, AlertTriangle, UserPlus, X } from 'lucide-react';
import AuditorPlayer from './AuditorPlayer';
import { statusLabel } from '../../lib/statusLabels';

const SEAL_COLORS: Record<string, string> = {
  'Ouro': '#FCD34D', 'Prata': '#9CA3AF', 'Bronze': '#B45309', 'Não Qualificado': '#EF4444',
};
// Sem selo/certificado: neutro que NÃO pode ser cinza (colidiria com o Prata).
const NO_SEAL_COLOR = '#A5B4FC';

// Instância fechada (terminal) → só visualização; a aberta é análise ativa.
// Dimensões exibidas ao lado do total (Segurança já consolida Documento Legal no backend).
const DIMENSOES: [string, string][] = [['Seg', 'Segurança'], ['Conf', 'Conforto'], ['Exp', 'Experiência do Cliente']];
const isClosedInstance = (status: string) =>
  ['aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado'].includes(status);
// Prestador ainda não enviou o roteiro — nada para analisar, só acompanhar o progresso.
const isNotSubmitted = (status: string) =>
  ['em_andamento', 'pendente'].includes(status);
// Rótulo do botão-olho por estado. Reanálise (aguardando_evidencia) tem texto e cor próprios.
const actionLabel = (status: string) =>
  isNotSubmitted(status) ? 'Acompanhar avaliação'
  : isClosedInstance(status) ? 'Visualizar avaliação'
  : status === 'aguardando_evidencia' ? 'Aguardando reanálise'
  : 'Analisar avaliação';
// Cor do botão-olho: verde só quando há o que analisar (em_analise); laranja em reanálise
// (mesma cor do status); cinza nos demais (acompanhar/visualizar).
const actionTone = (status: string) =>
  status === 'aguardando_evidencia' ? 'bg-orange-50 text-orange-700 hover:bg-orange-100'
  : (!isNotSubmitted(status) && !isClosedInstance(status)) ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
  : 'bg-gray-50 text-gray-500 hover:bg-gray-100';

function statusPill(status: string) {
  const map: Record<string, string> = {
    em_andamento: 'bg-blue-100 text-blue-700',
    pendente: 'bg-amber-100 text-amber-800',
    em_analise: 'bg-purple-100 text-purple-800',
    aguardando_evidencia: 'bg-orange-100 text-orange-800',
    aprovado: 'bg-emerald-100 text-emerald-800',
    reprovado: 'bg-red-100 text-red-700',
    finalizado: 'bg-emerald-100 text-emerald-800',
    ciclo_encerrado: 'bg-slate-200 text-slate-700',
  };
  return map[status] || 'bg-gray-100 text-gray-600';
}

export default function PainelDoCiclo({ user }: { user: any }) {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lowSecOnly, setLowSecOnly] = useState(false);
  const [evaluating, setEvaluating] = useState<any>(null);
  const [inclusaoOpen, setInclusaoOpen] = useState(false);
  const [candidateCount, setCandidateCount] = useState<number | null>(null);

  useEffect(() => { (async () => {
    const cs = await fetchApi('/eval/cycles');
    setCycles(cs);
    const active = cs.find((c: any) => c.active) || cs[0];
    if (active) setCycleId(active.id);
  })(); }, []);

  const cycleIsActive = cycles.find((c: any) => c.id === cycleId)?.active === true;

  const reloadPanel = async () => {
    if (cycleId == null) return;
    setData(await fetchApi(`/eval/dashboard/auditor?cycle_id=${cycleId}`));
    if (cycleIsActive) {
      const { rows } = await fetchApi(`/eval/cycles/${cycleId}/inclusion-candidates`);
      setCandidateCount(rows.length);
    }
  };

  useEffect(() => {
    if (cycleId == null) return;
    (async () => {
      setLoading(true);
      setCandidateCount(null);
      try { await reloadPanel(); }
      finally { setLoading(false); }
    })();
  }, [cycleId, cycles]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.instances.filter((i: any) => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (lowSecOnly && !(i.seguranca_pct != null && i.seguranca_pct < 60)) return false;
      if (!q) return true;
      return (i.provider_name || '').toLowerCase().includes(q)
        || (i.provider_code || '').toLowerCase().includes(q);
    });
  }, [data, search, statusFilter, lowSecOnly]);

  // Status presentes no ciclo (pra montar as opções do dropdown).
  const statusesPresent = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(new Set(data.instances.map((i: any) => i.status))) as string[];
  }, [data]);

  const reopen = async (inst: any) => {
    if (!confirm(`Devolver a avaliação de "${inst.provider_name}" para o prestador?`)) return;
    await fetchApi(`/eval/instances/${inst.id}/reopen`, { method: 'POST' });
    setData(await fetchApi(`/eval/dashboard/auditor?cycle_id=${cycleId}`));
  };

  if (loading || !data) {
    return <div className="p-8 text-center text-gray-500">Carregando painel...</div>;
  }

  const k = data.kpis;
  const sentPct = k.sent + k.pending > 0 ? Math.round((k.sent / (k.sent + k.pending)) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Painel do Ciclo</h1>
          <p className="text-sm text-gray-500">
            {data.cycle.label} · {data.cycle.start_date} → {data.cycle.end_date}
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <select
            className="border rounded-lg px-3 py-2 text-sm bg-white"
            value={cycleId ?? ''}
            onChange={e => setCycleId(Number(e.target.value))}
          >
            {cycles.map(c => (
              <option key={c.id} value={c.id}>{c.label}{c.active ? ' (ativo)' : ''}</option>
            ))}
          </select>
          <a
            href={`/api/eval/dashboard/auditor.xlsx?cycle_id=${cycleId}`}
            className="btn btn-outline flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Exportar .xlsx
          </a>
          {cycleIsActive && candidateCount != null && (
            <button
              onClick={() => setInclusaoOpen(true)}
              title="Prestadores/unidades que entraram no cadastro depois da abertura do ciclo"
              className="btn btn-outline flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" /> Incluir no ciclo
              {candidateCount > 0 && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">{candidateCount}</span>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Locais no ciclo" value={k.total_locations} />
        <Card label="Enviados / Pendentes" value={`${k.sent} / ${k.pending}`} sub={`${sentPct}% enviados`} />
        <Card label="Em análise" value={k.in_review} />
        <Card label="Aguardando reanálise" value={k.awaiting_provider} />
        <Card label="Média geral" value={`${k.avg_score.toFixed(1)}%`} />
        <Card label="Segurança < 60%" value={k.low_security_count}
          valueClass={k.low_security_count > 0 ? 'text-red-600' : undefined} />

        {/* Selos emitidos no ciclo — medalha (arte oficial dos e-mails) + quantidade · % */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Selos</p>
        {(() => {
          const dist = k.seal_distribution as Record<string, number>;
          const totalSeals = Object.values(dist).reduce((a, b) => a + (b as number), 0);
          const SEAL_IMG: Record<string, string> = {
            'Ouro': '/selos/ouro.png', 'Prata': '/selos/prata.png', 'Bronze': '/selos/bronze.png',
          };
          const order = ['Ouro', 'Prata', 'Bronze', 'Não Qualificado'].filter(s => (dist[s] || 0) > 0);
          if (totalSeals === 0) {
            return <p className="mt-1 text-sm text-gray-400">Nenhum selo emitido ainda.</p>;
          }
          return (
            <div className="mt-2 flex items-center gap-x-6 overflow-x-auto">
              {order.map(s => (
                <span key={s} className="inline-flex shrink-0 items-center gap-1.5" title={s}>
                  {SEAL_IMG[s]
                    ? <img src={SEAL_IMG[s]} alt={s} className="h-7 w-7 object-contain" />
                    : <span className="text-2xl" aria-hidden="true">🚫</span>}
                  <span className="text-lg font-bold text-secondary-900">
                    {dist[s]} <span className="text-sm font-semibold text-gray-500">· {Math.round((dist[s] / totalSeals) * 100)}%</span>
                  </span>
                </span>
              ))}
            </div>
          );
        })()}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por prestador ou código..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border-none rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-50 border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Todos os status ({data.instances.length})</option>
            {statusesPresent.map(st => (
              <option key={st} value={st}>
                {statusLabel(st)} ({data.instances.filter((i: any) => i.status === st).length})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setLowSecOnly(v => !v)}
            aria-pressed={lowSecOnly}
            title="Mostrar apenas prestadores com Segurança abaixo de 60%"
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
              lowSecOnly
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-red-700 border-red-200 hover:bg-red-50'
            }`}
          >
            <AlertTriangle className="w-4 h-4" /> Segurança &lt; 60% ({k.low_security_count})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-3 font-semibold text-gray-600 text-sm">Prestador</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Código</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Unidade</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Status</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Pontuação</th>
                <th className="p-3 font-semibold text-gray-600 text-sm">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">Nenhum resultado.</td></tr>
              ) : filtered.map((i: any) => (
                <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-900">{i.provider_name}</td>
                  <td className="p-3 text-sm text-gray-600">{i.provider_code || '—'}</td>
                  <td className="p-3 text-sm text-gray-600">{i.unidade || i.city || '—'}</td>
                  <td className="p-3">
                    <span className={`inline-block whitespace-nowrap px-2.5 py-1 text-[10px] font-bold uppercase rounded-full tracking-wide ${statusPill(i.status)}`}>
                      {statusLabel(i.status)}
                    </span>
                    {/* Estado derivado da Pesquisa (spec 2026-09-11): 'aguardando' = parecer
                        travado pela pesquisa; 'finalizada' = respondida. */}
                    {i.survey_state === 'aguardando' && (
                      <span className="mt-1 block w-fit whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                        Aguardando finalização da pesquisa
                      </span>
                    )}
                    {i.survey_state === 'finalizada' && (
                      <span className="mt-1 block w-fit whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        Pesquisa finalizada
                      </span>
                    )}
                    {/* Item 18 (homologação 09/2026): plano de ciclo anterior em aberto. */}
                    {i.prev_plan_pending && (
                      <span
                        className={`mt-1 block w-fit whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${i.prev_plan_dl ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
                        title={i.prev_plan_dl
                          ? 'Plano de ação de ciclo anterior com item de Documento Legal/sanitário pendente — o selo deste ciclo fica limitado a Bronze até a conclusão.'
                          : 'Plano de ação de ciclo anterior ainda em aberto.'}
                      >
                        {i.prev_plan_dl ? 'Plano DL pendente — selo máx. Bronze' : 'Plano pendente do ciclo anterior'}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="font-bold text-gray-700">{fmtPct(i.percentual)}</div>
                    {i.dims && (
                      <div className="mt-1 space-y-0.5">
                        {DIMENSOES.map(([abbr, key]) => {
                          const pct = i.dims[key];
                          if (pct == null) return null;
                          const danger = key === 'Segurança' && pct < 60;
                          return (
                            <div key={key} className="flex items-center gap-1.5 text-[10px] text-gray-500" title={`${key}: ${pct.toFixed(0)}%`}>
                              <span className="w-7 shrink-0">{abbr}</span>
                              <span className="h-1.5 w-12 shrink-0 rounded-full bg-gray-200">
                                <span className={`block h-full rounded-full ${danger ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              </span>
                              <span className={`tabular-nums ${danger ? 'font-semibold text-red-600' : ''}`}>{pct.toFixed(0)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEvaluating(i)}
                        title={actionLabel(i.status)}
                        aria-label={actionLabel(i.status)}
                        className={`inline-flex items-center gap-1 p-1.5 rounded ${actionTone(i.status)}`}
                      >
                        <Eye className="w-4 h-4" />
                        {i.status === 'aguardando_evidencia' && (
                          <span className="whitespace-nowrap text-xs font-medium">Aguardando reanálise</span>
                        )}
                      </button>
                      {i.status === 'em_analise' && (
                        <button
                          onClick={() => reopen(i)}
                          title="Devolver a avaliação para o prestador reeditar"
                          aria-label="Devolver a avaliação para o prestador reeditar"
                          className="p-1.5 rounded bg-orange-50 text-orange-700 hover:bg-orange-100"
                        ><Undo2 className="w-4 h-4" /></button>
                      )}
                      <button
                        onClick={() => i.certificate_id && window.open(`/qualificacao/certificado/${i.certificate_id}/imprimir`, '_blank', 'noopener')}
                        disabled={!i.has_certificate}
                        title={i.has_certificate ? `Ver certificado${i.seal ? ` — ${i.seal}` : ''}` : 'Certificado disponível após parecer final'}
                        aria-label={i.has_certificate ? 'Ver certificado' : 'Certificado indisponível'}
                        className="p-1.5 rounded bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      ><Award className="w-4 h-4" style={{ color: i.has_certificate ? (SEAL_COLORS[i.seal] || NO_SEAL_COLOR) : NO_SEAL_COLOR }} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {evaluating && (
        <AuditorPlayer
          instanceId={evaluating.id}
          onClose={async () => {
            setEvaluating(null);
            if (cycleId != null) setData(await fetchApi(`/eval/dashboard/auditor?cycle_id=${cycleId}`));
          }}
        />
      )}

      {inclusaoOpen && cycleId != null && (
        <InclusaoAvulsaModal
          cycleId={cycleId}
          isAdmin={user?.role === 'admin'}
          onClose={async () => { setInclusaoOpen(false); await reloadPanel(); }}
        />
      )}
    </div>
  );
}

// Modal da inclusão avulsa (spec 2026-09-15): fila "Aguardando inclusão" (pares sem
// instância no ciclo) + lista "Incluídos". Roteiro vem resolvido pela cascata no
// backend; "pendente de roteiro" exige escolha manual. Só admin inclui.
function InclusaoAvulsaModal({ cycleId, isAdmin, onClose }: { cycleId: number; isAdmin: boolean; onClose: () => void }) {
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [inclusions, setInclusions] = useState<any[]>([]);
  const [scripts, setScripts] = useState<any[]>([]);
  const [formFor, setFormFor] = useState<string | null>(null); // `${provider_id}:${location_id}`
  const [reason, setReason] = useState('');
  const [manualScript, setManualScript] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const [cand, incl] = await Promise.all([
      fetchApi(`/eval/cycles/${cycleId}/inclusion-candidates`),
      fetchApi(`/eval/cycles/${cycleId}/inclusions`),
    ]);
    setCandidates(cand.rows);
    setInclusions(incl.rows);
    if (cand.rows.some((r: any) => r.resolved_script_id == null) && !scripts.length) {
      const all = await fetchApi('/eval/scripts');
      setScripts((all as any[]).filter((s) => s.is_current !== false));
    }
  };
  useEffect(() => { load().catch((e) => setError(e.message)); }, [cycleId]);

  const incluir = async (c: any) => {
    setSaving(true); setError('');
    try {
      await fetchApi(`/eval/cycles/${cycleId}/inclusions`, {
        method: 'POST',
        body: JSON.stringify({
          provider_id: c.provider_id, location_id: c.location_id, reason: reason.trim(),
          ...(c.resolved_script_id == null && manualScript ? { script_id: Number(manualScript) } : {}),
        }),
      });
      setFormFor(null); setReason(''); setManualScript('');
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Incluir no ciclo</h2>
            <p className="text-sm text-gray-500">Prestadores/unidades que entraram no cadastro após a abertura.</p>
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {candidates == null ? (
            <p className="text-center text-sm text-gray-500">Carregando…</p>
          ) : (
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Aguardando inclusão ({candidates.length})</h3>
              {candidates.length === 0 ? (
                <p className="text-sm text-gray-400">Nenhum prestador/unidade fora do ciclo.</p>
              ) : candidates.map((c) => {
                const key = `${c.provider_id}:${c.location_id}`;
                const pendente = c.resolved_script_id == null;
                return (
                  <div key={key} className="border-b border-gray-50 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{c.provider_name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {[c.provider_code, c.location_label, c.city].filter(Boolean).join(' · ')}
                        </p>
                        {pendente ? (
                          <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Pendente de roteiro</span>
                        ) : (
                          <p className="text-xs text-gray-500">Roteiro: <span className="font-medium text-gray-700">{c.resolved_script_title}</span></p>
                        )}
                      </div>
                      {isAdmin && formFor !== key && (
                        <button onClick={() => { setFormFor(key); setReason(''); setManualScript(''); }}
                          className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
                          Incluir
                        </button>
                      )}
                    </div>
                    {formFor === key && (
                      <div className="mt-2 space-y-2 rounded-lg bg-gray-50 p-3">
                        {pendente && (
                          <select value={manualScript} onChange={(e) => setManualScript(e.target.value)}
                            className="w-full rounded-lg border-gray-200 text-sm">
                            <option value="">Escolha o roteiro…</option>
                            {scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                          </select>
                        )}
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                          placeholder="Motivo da inclusão (obrigatório) — ex.: credenciamento em 10/09"
                          className="w-full rounded-lg border-gray-200 text-sm" />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setFormFor(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancelar</button>
                          <button onClick={() => incluir(c)} disabled={saving || !reason.trim() || (pendente && !manualScript)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                            {saving ? 'Incluindo…' : 'Confirmar inclusão'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {inclusions.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Incluídos neste ciclo ({inclusions.length})</h3>
              {inclusions.map((i) => (
                <div key={i.id} className="border-b border-gray-50 py-2 text-sm">
                  <p className="font-medium text-gray-900">{i.provider_name} <span className="font-normal text-gray-500">· {i.location_label}</span></p>
                  <p className="text-xs text-gray-500">
                    {new Date(i.created_at).toLocaleDateString('pt-BR')} · {i.created_by_name || 'sistema'} · {i.script_title || '—'} — “{i.reason}”
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// Card de métrica no padrão do dashboard da Pesquisa (rótulo, número grande, legenda).
function Card({ label, value, sub, valueClass }: { label: string; value: React.ReactNode; sub?: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass || 'text-secondary-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
