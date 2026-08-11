import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { computeSurveyStats, SurveyRow } from '../../lib/surveyStats';
import { Loader2, MessageSquare } from 'lucide-react';

const Q3_LABEL: Record<string, string> = {
  sim_totalmente: 'Sim, totalmente', sim_parcialmente: 'Sim, parcialmente',
  neutro: 'Indiferente', nao_precisei_ajuda: 'Não, precisei de ajuda',
  nao_insuficientes: 'Não, foram insuficientes',
};

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
}

function Card({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-secondary-900">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

// Histograma simples em barras CSS (sem dependência de chart).
function Histogram({ title, labels, counts, barClass }: {
  title: string; labels: string[]; counts: number[]; barClass?: (i: number) => string;
}) {
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-secondary-900">{title}</p>
      <div className="flex items-end gap-1.5" style={{ height: 120 }}>
        {counts.map((c, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
            {c > 0 && <span className="mb-0.5 text-[10px] font-semibold text-gray-500">{c}</span>}
            <div
              className={`w-full rounded-t ${barClass?.(i) ?? 'bg-emerald-400'}`}
              style={{ height: `${Math.round((c / max) * 100)}%`, minHeight: c > 0 ? 2 : 0 }}
              title={`${c}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {labels.map((l, i) => <span key={i} className="flex-1 text-center text-[10px] text-gray-500">{l}</span>)}
      </div>
      {total === 0 && <p className="mt-1 text-center text-[11px] text-gray-400">Sem dados</p>}
    </div>
  );
}

// Cor da barra do NPS por faixa: detratores (0–6) vermelho, passivos (7–8) âmbar, promotores (9–10) verde.
const npsBar = (i: number) => (i <= 6 ? 'bg-red-400' : i <= 8 ? 'bg-amber-300' : 'bg-emerald-400');

const Q3_ORDER = ['sim_totalmente', 'sim_parcialmente', 'neutro', 'nao_precisei_ajuda', 'nao_insuficientes'];
const Q3_SHORT = ['Sim tot.', 'Sim parc.', 'Indif.', 'Não/ajuda', 'Insuf.'];
const RATING_LABELS = ['1', '2', '3', '4', '5'];
const NPS_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

export default function PesquisaDashboard({ user }: { user: any }) {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    const cs = await fetchApi('/eval/cycles');
    setCycles(cs);
    const active = cs.find((c: any) => c.active) || cs[0];
    if (active) setCycleId(active.id);
  })(); }, []);

  useEffect(() => {
    if (cycleId == null) return;
    setLoading(true);
    fetchApi(`/eval/surveys?cycle_id=${cycleId}`).then(setRows).finally(() => setLoading(false));
  }, [cycleId]);

  const stats = useMemo(() => computeSurveyStats(rows as SurveyRow[]), [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pesquisa de Satisfação</h1>
          <p className="text-sm text-gray-500">Indicadores da rede credenciada por ciclo</p>
        </div>
        <select className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          value={cycleId ?? ''} onChange={e => setCycleId(Number(e.target.value))}>
          {cycles.map((c: any) => <option key={c.id} value={c.id}>{c.label}{c.active ? ' (ativo)' : ''}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500">Nenhuma resposta neste ciclo.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card label="NPS" value={stats.nps.score ?? '—'} sub={`${stats.nps.promoters} prom · ${stats.nps.passives} pass · ${stats.nps.detractors} detr`} />
            <Card label="Respostas" value={stats.count} />
            <Card label="CSAT — Clareza (Q1)" value={stats.csat.q1 ?? '—'} sub="média 1–5" />
            <Card label="CSAT — Portal (Q2)" value={stats.csat.q2 ?? '—'} sub="média 1–5" />
            <Card label="CSAT — Processo (Q5)" value={stats.csat.q5 ?? '—'} sub="média 1–5" />
            <Card label="Dificuldade técnica (Q4)" value={stats.q4DifficultyPct != null ? `${stats.q4DifficultyPct}%` : '—'} sub="responderam Sim" />
            <Card label="Documentos claros (Q3)" value={stats.q3['sim_totalmente'] ?? 0} sub="Sim, totalmente" />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Distribuição por questão</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Histogram title="Q6 — Recomendação (NPS 0–10)" labels={NPS_LABELS} counts={stats.dist.q6} barClass={npsBar} />
              <Histogram title="Q1 — Clareza das instruções" labels={RATING_LABELS} counts={stats.dist.q1} />
              <Histogram title="Q2 — Facilidade do portal" labels={RATING_LABELS} counts={stats.dist.q2} />
              <Histogram title="Q5 — Processo (geral)" labels={RATING_LABELS} counts={stats.dist.q5} />
              <Histogram title="Q3 — Orientação de documentos" labels={Q3_SHORT} counts={Q3_ORDER.map(k => stats.q3[k] ?? 0)} />
              <Histogram title="Q4 — Dificuldade técnica" labels={['Sim', 'Não']} counts={[stats.q4Counts.sim, stats.q4Counts.nao]} barClass={i => (i === 0 ? 'bg-red-400' : 'bg-emerald-400')} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="p-3">Prestador</th><th className="p-3">Enviada</th>
                  <th className="p-3">NPS</th><th className="p-3">Q1</th><th className="p-3">Q2</th>
                  <th className="p-3">Q3</th><th className="p-3">Q5</th><th className="p-3">Dificuldade</th>
                  <th className="p-3">Comentários</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-t border-gray-50 align-top">
                    <td className="p-3 font-medium text-gray-900">{r.provider_name}</td>
                    <td className="p-3 text-gray-600">{fmtDate(r.submitted_at)}</td>
                    <td className="p-3 font-bold text-gray-700">{r.q6_nps ?? '—'}</td>
                    <td className="p-3 text-gray-600">{r.q1_clareza ?? '—'}</td>
                    <td className="p-3 text-gray-600">{r.q2_portal ?? '—'}</td>
                    <td className="p-3 text-gray-600">{Q3_LABEL[r.q3_documentos] || '—'}</td>
                    <td className="p-3 text-gray-600">{r.q5_geral ?? '—'}</td>
                    <td className="p-3 text-gray-600">
                      {r.q4_dificuldade ? 'Sim' : 'Não'}{r.q4_texto ? ` — ${r.q4_texto}` : ''}
                    </td>
                    <td className="p-3 text-gray-600">
                      {r.comentarios ? <span className="flex gap-1"><MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />{r.comentarios}</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
