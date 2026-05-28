import React, { useState, useEffect } from 'react';
import { fetchApi } from '../../lib/api';
import { X, CheckCircle, AlertTriangle, MessageSquare, Download, ShieldCheck } from 'lucide-react';

export default function AuditorEvaluationModal({ instanceId, onClose }: { instanceId: number, onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Local state for answers so auditor can override or comment
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [seal, setSeal] = useState<string>('');
  
  useEffect(() => {
    loadData();
  }, [instanceId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetchApi(`/eval/instances/${instanceId}`);
      
      const scriptRes = await fetchApi(`/eval/scripts/${res.script_id}`);
      
      setData({ ...res, script: scriptRes });
      
      const ansObj: Record<number, any> = {};
      if (res.answers) {
        res.answers.forEach((a: any) => {
          ansObj[a.question_id] = { ...a };
        });
      }
      setAnswers(ansObj);
      setSeal(res.seal || '');
      
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar avaliação');
    } finally {
      setLoading(false);
    }
  };

  const handleAuditorChange = (qId: number, field: string, value: any) => {
    setAnswers(prev => ({
      ...prev,
      [qId]: {
        ...prev[qId],
        [field]: value
      }
    }));
  };

  const handleFinishEvaluation = async () => {
    try {
      setSaving(true);
      // Auditor might have changed some scores, let's recalculate total
      let newTotal = 0;
      let newMax = 0;
      
      data.script.questions.forEach((q: any) => {
        newMax += q.max_score;
        if (answers[q.id]?.answer_value === 'sim') { // Simplify logic for MVP
          newTotal += q.max_score;
        }
      });
      
      let calculatedSeal = seal;
      const percentual = newMax > 0 ? (newTotal / newMax) * 100 : 0;
      
      if (!calculatedSeal) {
        if (percentual >= 90) calculatedSeal = 'Ouro';
        else if (percentual >= 60) calculatedSeal = 'Prata';
        else calculatedSeal = 'Bronze';
      }

      await fetchApi(`/eval/instances/${instanceId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'finalizado',
          score: newTotal,
          percentual: percentual,
          max_possible_score: newMax,
          seal: calculatedSeal
        })
      });
      
      // Update answers array
      const ansArray = Object.keys(answers).map(k => ({
        question_id: parseInt(k),
        ...answers[parseInt(k)]
      }));
      
      await fetchApi(`/eval/instances/${instanceId}/answers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: ansArray })
      });

      alert('Auditoria finalizada com sucesso!');
      onClose();
    } catch (err) {
      console.error(err);
      alert('Erro ao finalizar auditoria');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) return (
    <div className="fixed inset-0 z-50 bg-gray-900/50 flex justify-center items-center">
      <div className="bg-white p-6 rounded-xl shadow-xl flex items-center gap-3">
        <div className="animate-spin h-5 w-5 border-b-2 border-emerald-600 rounded-full"></div>
        <span className="font-medium text-gray-700">Carregando avaliação...</span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/80 flex justify-center p-4 sm:p-8 overflow-hidden backdrop-blur-sm">
      <div className="bg-gray-50 flex flex-col w-full max-w-5xl h-full rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Auditoria: {data.provider_name}</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-500 font-medium">Roteiro: {data.script.title}</span>
              <span className="w-1 h-1 rounded-full bg-gray-300"></span>
              <span className="text-sm font-bold text-emerald-600">Score Atual: {Number(data.percentual).toFixed(1)}%</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {data.script.questions.map((q: any) => {
             const ans = answers[q.id] || {};
             const evs = data.evidences || [];
             
             return (
               <div key={q.id} className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
                 <div className="flex items-start gap-4">
                    <div className="w-10 h-10 shrink-0 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-sm">
                      {q.code}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <h4 className="text-sm font-bold text-gray-900">{q.text}</h4>
                        <div className="flex gap-2 mt-2">
                           <span className={`px-2 py-0.5 text-xs font-bold rounded uppercase ${
                             ans.answer_value === 'sim' ? 'bg-emerald-100 text-emerald-800' :
                             ans.answer_value === 'nao' ? 'bg-red-100 text-red-800' :
                             ans.answer_value === 'na' ? 'bg-gray-100 text-gray-800' :
                             'bg-gray-50 text-gray-400 border border-gray-200'
                           }`}>
                             Resp: {ans.answer_value?.toUpperCase() || 'Pendente'}
                           </span>
                           {q.evidence_required && (
                             <span className="px-2 py-0.5 text-xs font-bold rounded uppercase bg-blue-50 text-blue-700">Evidência Obrig.</span>
                           )}
                        </div>
                      </div>

                      <div className="bg-gray-50 p-4 rounded-lg space-y-3 border border-gray-100 mt-4">
                        <h5 className="text-xs font-bold text-gray-700 uppercase">Anotações do Auditor</h5>
                        
                        <div className="flex gap-4">
                           <label className="flex items-center gap-2 text-sm text-gray-800">
                             <input type="checkbox" 
                               checked={ans.is_non_compliant === 1} 
                               onChange={(e) => handleAuditorChange(q.id, 'is_non_compliant', e.target.checked ? 1 : 0)}
                             />
                             Marcar Não Conformidade
                           </label>
                        </div>
                        
                        <textarea 
                          value={ans.auditor_observation || ''}
                          onChange={(e) => handleAuditorChange(q.id, 'auditor_observation', e.target.value)}
                          placeholder="Observações do auditor para este item..."
                          className="w-full text-sm p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500"
                          rows={2}
                        ></textarea>
                      </div>
                    </div>
                 </div>
               </div>
             )
          })}
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-sm font-bold text-gray-700">Classificação Final:</label>
            <select 
              value={seal} 
              onChange={e => setSeal(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 font-bold"
            >
              <option value="">- Automática -</option>
              <option value="Ouro">Ouro (90%+)</option>
              <option value="Prata">Prata (60%+)</option>
              <option value="Bronze">Bronze (Até 60%)</option>
            </select>
          </div>
          
          <button 
             onClick={handleFinishEvaluation}
             disabled={saving}
             className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm flex items-center gap-2 transition-colors disabled:opacity-70"
          >
             {saving ? 'Finalizando...' : <><ShieldCheck className="w-5 h-5" /> Emitir Certificação e Finalizar</>}
          </button>
        </div>
      </div>
    </div>
  );
}
