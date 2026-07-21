import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, Check, XCircle, RotateCcw, ChevronDown, ChevronUp, ShieldCheck, FileText } from 'lucide-react';
import { statusLabel } from '../../lib/statusLabels';

interface Answer {
  id: number; question_id: number;
  answer_value: string | null; score_obtained: number;
  evidence_url: string | null; evidence_status: string | null;
  auditor_observation: string | null; provider_observation: string | null;
  is_non_compliant: boolean;
}
interface Question {
  id: number; code: string | null; text: string; dimension: string | null;
  max_score: number; document_type: string | null;
}
interface Iteration {
  id: number; iteration_number: number; actor_role: string; action: string;
  answer_value: string | null; observation: string | null; evidence_url: string | null; created_at: string;
}

export default function AuditorEvaluationModal({ instanceId, onClose }: { instanceId: number; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [iterations, setIterations] = useState<Record<number, Iteration[]>>({});
  const [loading, setLoading] = useState(true);
  const [openHistory, setOpenHistory] = useState<Set<number>>(new Set());
  const [reasonPrompt, setReasonPrompt] = useState<{ answerId: number; action: 'reprovou' | 'solicitou_reanalise' } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const inst = await fetchApi(`/eval/instances/${instanceId}`);
      const script = await fetchApi(`/eval/scripts/${inst.script_id}`);
      setData({ ...inst, script });
      const map: Record<number, Answer> = {};
      (inst.answers || []).forEach((a: Answer) => { map[a.question_id] = a; });
      setAnswers(map);
      // Iterations: assume endpoint futuro; por ora, coleta de inst.answers se vier.
      const iters: Record<number, Iteration[]> = {};
      (inst.answers || []).forEach((a: any) => { iters[a.id] = a.iterations || []; });
      setIterations(iters);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [instanceId]);

  const act = async (answerId: number, action: 'aprovou' | 'reprovou' | 'solicitou_reanalise', observation?: string) => {
    setBusy(true);
    const path = action === 'aprovou' ? 'aprovar' : action === 'reprovou' ? 'reprovar' : 'solicitar-reanalise';
    try {
      await fetchApi(`/eval/answers/${answerId}/${path}`, {
        method: 'POST', body: JSON.stringify({ observation: observation || '' }),
      });
      await load();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); setReasonPrompt(null); setReasonText(''); }
  };

  const emitirParecer = async () => {
    if (!confirm('Emitir parecer final? Esta ação fecha a avaliação.')) return;
    setBusy(true);
    try {
      const res = await fetchApi(`/eval/instances/${instanceId}/parecer`, { method: 'POST' });
      alert(`Parecer emitido: ${res.seal} (${res.percentual.toFixed(2)}%)`);
      onClose();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  const summary = useMemo(() => {
    const qs: Question[] = data?.script?.questions || [];
    let aprovados = 0, reprovados = 0, reanalise = 0, sem = 0;
    for (const q of qs) {
      const a = answers[q.id];
      if (!a) { sem++; continue; }
      if (a.evidence_status === 'aprovado') aprovados++;
      else if (a.evidence_status === 'reprovado') reprovados++;
      else if (a.evidence_status === 'aguardando_reanalise') reanalise++;
      else sem++;
    }
    return { aprovados, reprovados, reanalise, sem, canFinish: reanalise === 0 && sem === 0 };
  }, [data, answers]);

  if (loading || !data) {
    return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"><p className="text-white">Carregando...</p></div>;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex justify-center p-4 backdrop-blur-sm">
      <div className="bg-gray-50 w-full max-w-5xl flex flex-col rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-white px-6 py-4 border-b flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">Auditoria: {data.provider_name}</h2>
            <p className="text-sm text-gray-500">{data.script.title} · {statusLabel(data.status)}</p>
          </div>
          <button onClick={onClose}><X className="w-6 h-6 text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {data.script.questions.map((q: Question) => {
            const a = answers[q.id];
            if (!a) return null;
            const bypass = (a.auditor_observation || '').includes('Aprovado via cadastro');
            const iters = iterations[a.id] || [];
            const historyOpen = openHistory.has(a.id);
            const terminal = a.evidence_status === 'aprovado' || a.evidence_status === 'reprovado';
            return (
              <div key={q.id} className="bg-white p-4 border rounded-xl">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-mono text-gray-500">{q.code} · {q.dimension}</p>
                    <p className="font-semibold text-sm mt-1">{q.text}</p>
                    <p className="text-sm mt-2">Resposta: <strong>{a.answer_value || '—'}</strong></p>
                    {a.evidence_url && <a href={a.evidence_url} target="_blank" className="text-sm text-blue-600 underline flex items-center gap-1 mt-1"><FileText className="w-3 h-3" /> Evidência</a>}
                    {a.provider_observation && <p className="text-xs text-gray-600 italic mt-1">"{a.provider_observation}"</p>}
                    {bypass && <span className="inline-block mt-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded">Atendido via cadastro</span>}
                    {a.evidence_status && <span className={`inline-block mt-2 ml-2 px-2 py-0.5 text-xs font-bold rounded ${
                      a.evidence_status === 'aprovado' ? 'bg-emerald-100 text-emerald-800' :
                      a.evidence_status === 'reprovado' ? 'bg-red-100 text-red-800' :
                      a.evidence_status === 'aguardando_reanalise' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100'
                    }`}>{a.evidence_status.replace('_', ' ')}</span>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button disabled={busy || terminal} onClick={() => act(a.id, 'aprovou')} className="px-3 py-1.5 text-xs bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 disabled:opacity-40 flex items-center gap-1"><Check className="w-3 h-3" /> Aprovar</button>
                  <button disabled={busy || terminal} onClick={() => { setReasonPrompt({ answerId: a.id, action: 'reprovou' }); setReasonText(''); }} className="px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 disabled:opacity-40 flex items-center gap-1"><XCircle className="w-3 h-3" /> Reprovar</button>
                  <button disabled={busy || terminal} onClick={() => { setReasonPrompt({ answerId: a.id, action: 'solicitou_reanalise' }); setReasonText(''); }} className="px-3 py-1.5 text-xs bg-orange-50 text-orange-700 rounded hover:bg-orange-100 disabled:opacity-40 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Reanálise</button>
                  {iters.length > 0 && (
                    <button onClick={() => setOpenHistory(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} className="ml-auto text-xs text-gray-600 flex items-center gap-1">
                      {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Histórico ({iters.length})
                    </button>
                  )}
                </div>
                {reasonPrompt?.answerId === a.id && (
                  <div className="mt-3 p-3 bg-gray-100 rounded">
                    <textarea value={reasonText} onChange={e => setReasonText(e.target.value)} placeholder="Justificativa obrigatória..." className="w-full p-2 border rounded text-sm" rows={2} />
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => setReasonPrompt(null)} className="text-xs px-3 py-1 border rounded">Cancelar</button>
                      <button disabled={!reasonText.trim()} onClick={() => act(a.id, reasonPrompt.action, reasonText)} className="text-xs px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-40">Confirmar</button>
                    </div>
                  </div>
                )}
                {historyOpen && (
                  <div className="mt-3 pl-4 border-l-2 border-gray-200 space-y-2">
                    {iters.map(it => (
                      <div key={it.id} className="text-xs text-gray-700">
                        <span className="font-semibold">#{it.iteration_number} · {it.actor_role} · {it.action}</span>
                        <span className="text-gray-500"> ({new Date(it.created_at).toLocaleString('pt-BR')})</span>
                        {it.observation && <p className="italic text-gray-600">"{it.observation}"</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-white border-t px-6 py-4 flex justify-between items-center">
          <div className="text-sm">
            <span className="text-emerald-700 font-semibold">{summary.aprovados} ✓</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-red-700 font-semibold">{summary.reprovados} ✗</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-orange-700 font-semibold">{summary.reanalise} 🔁</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-gray-600 font-semibold">{summary.sem} sem análise</span>
          </div>
          <button onClick={emitirParecer} disabled={busy || !summary.canFinish} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded disabled:opacity-50 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Emitir Parecer Final
          </button>
        </div>
      </div>
    </div>
  );
}
