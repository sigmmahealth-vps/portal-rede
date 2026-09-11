import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { fmtPct } from '../../lib/formatDate';
import { Search, Download, Eye, Undo2, Award, AlertTriangle } from 'lucide-react';
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

  useEffect(() => { (async () => {
    const cs = await fetchApi('/eval/cycles');
    setCycles(cs);
    const active = cs.find((c: any) => c.active) || cs[0];
    if (active) setCycleId(active.id);
  })(); }, []);

  useEffect(() => {
    if (cycleId == null) return;
    (async () => {
      setLoading(true);
      try { setData(await fetchApi(`/eval/dashboard/auditor?cycle_id=${cycleId}`)); }
      finally { setLoading(false); }
    })();
  }, [cycleId]);

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
