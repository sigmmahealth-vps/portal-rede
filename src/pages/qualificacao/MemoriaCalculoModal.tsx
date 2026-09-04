import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, Loader2, AlertTriangle } from 'lucide-react';

const answerLabel = (v: string | null) =>
  v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : v === 'na' ? 'N/A' : '—';

// Situação de um critério que conta: pontuou (obtido = máx) ou não conformidade
// (perdeu ponto — ex.: "Não" ou "N/A reprovado"). Os fora do cálculo (N/A aprovado
// / sem resposta) não entram na tabela; aparecem na seção "Fora do cálculo".
const situacaoPontuou = { label: 'Pontuou', cls: 'bg-emerald-50 text-emerald-700' };
const situacaoNaoConforme = { label: 'Não conformidade', cls: 'bg-red-50 text-red-700' };

export default function MemoriaCalculoModal({ instanceId, onClose }: { instanceId: number; onClose: () => void }) {
  const [mem, setMem] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setMem(await fetchApi(`/eval/instances/${instanceId}/memoria-calculo`)); }
      catch (e: any) { alert(e?.message || 'Erro ao carregar memória de cálculo'); }
      finally { setLoading(false); }
    })();
  }, [instanceId]);

  const headlinePct = mem?.stored ? mem.stored.percentual : mem?.final_pct;
  const headlineSeal = mem?.stored ? mem.stored.seal : mem?.seal;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-secondary-900">Memória de cálculo</h2>
            {mem?.stored && <p className="text-xs text-gray-500">Valores oficiais gravados no parecer.</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        {loading || !mem ? (
          <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <span className="text-2xl font-bold text-secondary-900">{Number(headlinePct).toFixed(2)}%</span>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">{headlineSeal || '—'}</span>
              {mem.eliminatory_failed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Não conformidade em critério eliminatório
                </span>
              )}
            </div>

            {mem.dimensions.map((dim: any) => {
              // Classes cruas que caem neste grupo, exceto a de mesmo nome — deixa
              // explícito o agrupamento (ex.: Segurança "inclui Documento Legal").
              const inclui = Array.from(new Set(
                mem.criteria
                  .filter((c: any) => c.dimension === dim.dimension && c.classification === 'conta')
                  .map((c: any) => c.classe),
              )).filter((cl: any) => cl !== dim.dimension);
              return (
              <section key={dim.dimension} className="mb-4">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold text-secondary-900">
                    {dim.dimension}
                    {inclui.length > 0 && (
                      <span className="ml-1 font-normal text-gray-500">(inclui {inclui.join(', ')})</span>
                    )}
                  </h3>
                  <span className="shrink-0 text-xs font-semibold text-gray-600">{dim.obtained}/{dim.max} · {dim.pct}%</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500">
                        <th className="py-1 pr-2">Cód.</th><th className="py-1 pr-2">Classe</th><th className="py-1 pr-2">Resposta</th>
                        <th className="py-1 pr-2">Obtido/Máx</th><th className="py-1 pr-2">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mem.criteria.filter((c: any) => c.dimension === dim.dimension && c.classification === 'conta').map((c: any) => {
                        const sit = c.obtained >= c.max ? situacaoPontuou : situacaoNaoConforme;
                        return (
                        <tr key={c.question_id} className="border-b border-gray-50">
                          <td className="py-1 pr-2 font-mono text-xs">{c.code || '—'}{c.is_eliminatory ? ' ⛔' : ''}</td>
                          <td className="py-1 pr-2 text-xs text-gray-600">{c.classe}</td>
                          <td className="py-1 pr-2">{answerLabel(c.answer_value)}</td>
                          <td className="py-1 pr-2 tabular-nums">{c.obtained}/{c.max}</td>
                          <td className="py-1 pr-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${sit.cls}`}>{sit.label}</span></td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              );
            })}

            {(mem.out_of_calc.na_aprovado.length > 0 || mem.out_of_calc.sem_resposta.length > 0) && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                <p className="font-semibold text-gray-700">Fora do cálculo (não entram no denominador)</p>
                {mem.out_of_calc.na_aprovado.length > 0 && <p className="mt-1">N/A aprovado: {mem.out_of_calc.na_aprovado.join(', ')}</p>}
                {mem.out_of_calc.sem_resposta.length > 0 && <p className="mt-1">Sem resposta: {mem.out_of_calc.sem_resposta.join(', ')}</p>}
              </div>
            )}

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-secondary-900">
              <div className="flex justify-between"><span>Base (Σ obtido / Σ máx)</span><span className="font-semibold tabular-nums">{mem.totals.obtained}/{mem.totals.max} = {mem.totals.base_pct}%</span></div>
              <div className="flex justify-between"><span>Bônus da pesquisa (pontos no numerador)</span><span className="font-semibold tabular-nums">{mem.bonus_pending ? '0 (pesquisa pendente)' : `+${mem.bonus}`}</span></div>
              <div className="mt-1 flex justify-between border-t border-emerald-200 pt-1 text-base font-bold"><span>Nota final (teto 100)</span><span className="tabular-nums">{mem.bonus_pending || !mem.bonus ? '' : `(${mem.totals.obtained}+${mem.bonus})/${mem.totals.max} = `}{mem.final_pct}%</span></div>
              <div className="flex justify-between"><span>Selo</span><span className="font-semibold">{mem.seal}</span></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
