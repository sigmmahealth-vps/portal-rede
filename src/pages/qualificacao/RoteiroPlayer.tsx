import React, { useState, useEffect } from 'react';
import { fetchApi } from '../../lib/api';
import { Check, ChevronLeft, ChevronRight, UploadCloud, AlertCircle, Search, Save, X } from 'lucide-react';

interface Question {
  id: number;
  section_id: number;
  code: string | null;
  text: string;
  legislation: string;
  type: string;
  weight: number;
  max_score: number;
  evidence_required: boolean;
  is_eliminatory: boolean;
  order_index: number;
  dimension?: string | null;
  guidance?: string | null;
}

interface Section {
  id: number;
  parent_section_id: number | null;
  name: string;
  order_index: number;
}

interface Answer {
  answer_value: string;
  score_obtained: number;
  file?: File | null;
  file_url?: string;
  is_na?: boolean;
}

export default function RoteiroPlayer({ 
  scriptId, 
  instanceId, 
  onClose,
  providerId
}: { 
  scriptId: number; 
  instanceId?: number; 
  onClose: () => void;
  providerId: number;
}) {
  const [script, setScript] = useState<any>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Real instance ID (if we started a new one)
  const [currentInstanceId, setCurrentInstanceId] = useState<number | null>(instanceId || null);

  useEffect(() => {
    loadScript();
  }, [scriptId]);

  const loadScript = async () => {
    setLoading(true);
    try {
      const data = await fetchApi(`/eval/scripts/${scriptId}`);
      setScript(data);

      // Esconde grupos-raiz puramente qualitativos (sem nenhum critério pontuado na subárvore):
      // PONTOS FORTES, CONSTATAÇÕES DA VISITA etc. são preenchidos pelo auditor, não pelo
      // prestador — não devem virar etapas vazias na autoavaliação.
      const allSections: Section[] = data.sections || [];
      const allQuestions: Question[] = data.questions || [];
      const childMap = new Map<number | null, Section[]>();
      for (const s of allSections) {
        const k = s.parent_section_id ?? null;
        const arr = childMap.get(k);
        if (arr) arr.push(s); else childMap.set(k, [s]);
      }
      const sectionsWithQ = new Set(allQuestions.map(q => q.section_id));
      const subtreeHasQ = (id: number): boolean =>
        sectionsWithQ.has(id) || (childMap.get(id) ?? []).some(c => subtreeHasQ(c.id));
      const sectionById = new Map(allSections.map(s => [s.id, s] as const));
      const rootIdOf = (s: Section): number => {
        let cur: Section | undefined = s;
        while (cur && cur.parent_section_id) cur = sectionById.get(cur.parent_section_id);
        return cur ? cur.id : s.id;
      };
      const keptRootIds = new Set(
        (childMap.get(null) ?? []).filter(r => subtreeHasQ(r.id)).map(r => r.id),
      );
      const visibleSections = allSections.filter(s => keptRootIds.has(rootIdOf(s)));

      setSections(visibleSections);
      setQuestions(allQuestions);

      const firstRoot = visibleSections.find((s: Section) => !s.parent_section_id) || visibleSections[0];
      if (firstRoot) setActiveSectionId(firstRoot.id);

      if (instanceId) {
        const instanceData = await fetchApi(`/eval/instances/${instanceId}`);
        const loadedAnswers: Record<number, Answer> = {};
        if (instanceData.answers) {
          instanceData.answers.forEach((ans: any) => {
            loadedAnswers[ans.question_id] = {
              answer_value: ans.answer_value,
              score_obtained: ans.score_obtained,
            };
          });
        }
        setAnswers(loadedAnswers);
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar roteiro');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionId: number, value: string, score: number) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        answer_value: value,
        score_obtained: score
      }
    }));
  };

  const handleFileUpload = async (questionId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Actually upload it now, or keep it in state. Better to upload it if we have an instance ID.
    // If no instance ID, we must create one.
    let instId = currentInstanceId;
    if (!instId) {
      try {
        const { id } = await fetchApi('/eval/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script_id: scriptId, provider_id: providerId })
        });
        instId = id;
        setCurrentInstanceId(id);
      } catch (err) {
        console.error(err);
        alert('Erro ao iniciar avaliação para upload');
        return;
      }
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('provider_id', providerId.toString());
    
    try {
      const res = await fetchApi(`/eval/instances/${instId}/evidence`, {
        method: 'POST',
        body: formData
      });
      
      setAnswers(prev => ({
        ...prev,
        [questionId]: {
          ...prev[questionId],
          file_url: res.url
        }
      }));
    } catch (err) {
      alert('Erro ao fazer upload da evidência');
    }
  };

  const saveProgress = async (goToNext: boolean = false) => {
    setSaving(true);
    try {
      let instId = currentInstanceId;
      if (!instId) {
        const { id } = await fetchApi('/eval/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script_id: scriptId, provider_id: providerId })
        });
        instId = id;
        setCurrentInstanceId(id);
      }

      // Format answers
      const answersArray = Object.keys(answers).map(qId => ({
        question_id: parseInt(qId),
        answer_value: answers[parseInt(qId)].answer_value,
        score_obtained: answers[parseInt(qId)].score_obtained,
        is_non_compliant: (answers[parseInt(qId)].answer_value === 'nao' || answers[parseInt(qId)].answer_value === 'NAO') ? 1 : 0
      }));

      await fetchApi(`/eval/instances/${instId}/answers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: answersArray })
      });
      
      if (!goToNext) {
        alert('Progresso salvo com sucesso!');
      } else {
        // Move to next section
        const rootSections = sections.filter(s => !s.parent_section_id);
        const currentIndex = rootSections.findIndex(s => s.id === activeSectionId);
        if (currentIndex !== -1 && currentIndex < rootSections.length - 1) {
          setActiveSectionId(rootSections[currentIndex + 1].id);
          window.scrollTo(0, 0);
        } else if (currentIndex === rootSections.length - 1) {
          if (confirm('Deseja concluir a avaliação? Ela será enviada para análise.')) {
            await finishEvaluation(instId);
          }
        }
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar progresso');
    } finally {
      setSaving(false);
    }
  };

  const finishEvaluation = async (instId: number) => {
    let totalScore = 0;
    let maxScore = 0;
    
    questions.forEach(q => {
      // numeric do Postgres chega como string ("10.00"); coerção evita concatenação.
      const pts = Number(q.max_score) || 0;
      maxScore += pts;
      if (answers[q.id]?.answer_value === 'sim') {
        totalScore += pts;
      }
    });

    const percentual = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    
    try {
      await fetchApi(`/eval/instances/${instId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: 'pendente', // Enviado para auditoria
          score: totalScore,
          max_possible_score: maxScore,
          percentual: percentual
        })
      });
      alert('Avaliação concluída e enviada com sucesso!');
      onClose();
    } catch (err) {
      alert('Erro ao concluir avaliação');
    }
  };

  if (loading) return <div className="p-8 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto"></div></div>;

  // Os roteiros têm hierarquia de profundidade variável (grupo → seção → subseção → critério).
  // order_index é relativo aos irmãos, então a ordem correta só emerge andando a árvore —
  // não dá para confiar no ORDER BY plano do endpoint.
  const childrenByParent = new Map<number | null, Section[]>();
  for (const s of sections) {
    const key = s.parent_section_id ?? null;
    const arr = childrenByParent.get(key);
    if (arr) arr.push(s); else childrenByParent.set(key, [s]);
  }
  for (const arr of childrenByParent.values()) arr.sort((a, b) => a.order_index - b.order_index);

  const questionsBySection = new Map<number, Question[]>();
  for (const q of questions) {
    const arr = questionsBySection.get(q.section_id);
    if (arr) arr.push(q); else questionsBySection.set(q.section_id, [q]);
  }
  for (const arr of questionsBySection.values()) arr.sort((a, b) => a.order_index - b.order_index);

  // IDs de toda a subárvore de uma seção (ela + descendentes), p/ contagem no stepper.
  const descendantSectionIds = (rootId: number): number[] => {
    const ids: number[] = [];
    const walk = (id: number) => { ids.push(id); for (const c of childrenByParent.get(id) ?? []) walk(c.id); };
    walk(rootId);
    return ids;
  };

  const rootSections = childrenByParent.get(null) ?? [];
  const activeRootIndex = rootSections.findIndex(s => s.id === activeSectionId);
  const activeRoot = rootSections[activeRootIndex] ?? rootSections[0];

  // Lista achatada (DFS) das seções do grupo ativo, cada uma com sua profundidade p/ estilo.
  const renderList: { section: Section; depth: number }[] = [];
  if (activeRoot) {
    const walk = (id: number, depth: number) => {
      const sec = sections.find(s => s.id === id);
      if (!sec) return;
      renderList.push({ section: sec, depth });
      for (const c of childrenByParent.get(id) ?? []) walk(c.id, depth + 1);
    };
    walk(activeRoot.id, 0);
  }

  const calculateProgress = () => {
    const answeredCount = Object.keys(answers).length;
    return questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
      <div className="bg-gray-50 flex flex-col w-full max-w-6xl h-full rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{script?.title}</h2>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-sm font-medium text-gray-500">
                Progresso: {calculateProgress()}%
              </span>
              <div className="h-2 w-48 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-500" 
                  style={{ width: `${calculateProgress()}%` }}
                ></div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar / Stepper */}
          <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto shrink-0 hidden md:block p-4">
            <nav className="space-y-2">
              {rootSections.map((sec, idx) => {
                const isActive = sec.id === activeSectionId;
                // Count questions inside this section or sub-sections
                const secFamilyIds = descendantSectionIds(sec.id);
                const secQs = questions.filter(q => secFamilyIds.includes(q.section_id));
                const qsAnswered = secQs.filter(q => answers[q.id]).length;
                const isComplete = secQs.length > 0 && qsAnswered === secQs.length;

                return (
                  <button
                    key={sec.id}
                    onClick={() => setActiveSectionId(sec.id)}
                    className={`w-full text-left p-3 rounded-xl flex flex-col gap-1 transition-all ${
                      isActive 
                        ? 'bg-emerald-50 border border-emerald-200' 
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className={`text-sm font-bold ${isActive ? 'text-emerald-800' : 'text-gray-700'}`}>
                        {sec.name}
                      </span>
                      {isComplete && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                    </div>
                    <span className="text-xs text-gray-500 font-medium">
                      {qsAnswered} / {secQs.length} respondidas
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-gray-50 relative">
            <div className="max-w-3xl mx-auto space-y-8 pb-24">
              
              {renderList.map(({ section: renderSec, depth }) => {
                const secQuestions = questionsBySection.get(renderSec.id) ?? [];
                const showHeader = depth >= 1;
                if (secQuestions.length === 0 && !showHeader) return null;

                return (
                  <div key={renderSec.id} className="space-y-6">
                    {showHeader && (depth === 1 ? (
                      <h3 className="text-lg font-bold text-gray-800 pb-2 border-b border-gray-200">
                        {renderSec.name}
                      </h3>
                    ) : (
                      <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide pt-1">
                        {renderSec.name}
                      </h4>
                    ))}

                    {secQuestions.length > 0 && (
                    <div className="space-y-6">
                      {secQuestions.map(q => {
                        const ans = answers[q.id];
                        const isNonCompliant = ans?.answer_value === 'nao';
                        
                        return (
                          <div key={q.id} className={`bg-white rounded-xl shadow-sm border p-6 transition-all ${isNonCompliant ? 'border-red-200 bg-red-50/10' : 'border-gray-200 hover:shadow-md'}`}>
                            <div className="flex items-start gap-4">
                              <div className="px-2 min-w-10 h-10 shrink-0 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-xs">
                                {q.code || '+'}
                              </div>
                              <div className="flex-1 space-y-4">
                                <div>
                                  <h4 className="text-base font-medium text-gray-900">{q.text}</h4>
                                  <div className="flex flex-wrap items-center gap-2 mt-2">
                                    {q.dimension && (
                                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-sky-50 text-sky-700 border border-sky-100">
                                        {q.dimension}
                                      </span>
                                    )}
                                    {q.max_score > 0 && (
                                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-100">
                                        {q.max_score} pts
                                      </span>
                                    )}
                                  </div>
                                  {q.legislation && (
                                    <p className="text-xs text-gray-500 mt-1 font-mono uppercase tracking-wide">Ref: {q.legislation}</p>
                                  )}
                                  {q.guidance && (
                                    <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                                      <span className="font-semibold text-gray-600">Evidência: </span>{q.guidance}
                                    </p>
                                  )}
                                </div>
                                
                                {q.type === 'sim_nao' && (
                                  <div className="flex flex-wrap items-center gap-3">
                                    <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer font-medium text-sm transition-all ${ans?.answer_value === 'sim' ? 'bg-emerald-50 border-emerald-500 text-emerald-700 ring-1 ring-emerald-500 pt' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                                      <input type="radio" name={`q_${q.id}`} className="hidden" checked={ans?.answer_value === 'sim'} onChange={() => handleAnswerChange(q.id, 'sim', q.max_score)} />
                                      SIM
                                    </label>
                                    <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer font-medium text-sm transition-all ${ans?.answer_value === 'nao' ? 'bg-red-50 border-red-500 text-red-700 ring-1 ring-red-500' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                                      <input type="radio" name={`q_${q.id}`} className="hidden" checked={ans?.answer_value === 'nao'} onChange={() => handleAnswerChange(q.id, 'nao', 0)} />
                                      NÃO
                                    </label>
                                    <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer font-medium text-sm transition-all ${ans?.answer_value === 'na' ? 'bg-gray-100 border-gray-400 text-gray-800 ring-1 ring-gray-400' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                                      <input type="radio" name={`q_${q.id}`} className="hidden" checked={ans?.answer_value === 'na'} onChange={() => handleAnswerChange(q.id, 'na', q.max_score)} />
                                      N/A
                                    </label>
                                  </div>
                                )}

                                {isNonCompliant && (
                                  <div className="bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                    <div>
                                      <p className="text-sm font-bold text-red-800">Não conformidade identificada</p>
                                      <p className="text-xs text-red-600 mt-1">Isso exigirá um plano de ação após a conclusão.</p>
                                    </div>
                                  </div>
                                )}

                                {q.evidence_required && ans?.answer_value !== 'na' && (
                                  <div className="mt-4 pt-4 border-t border-gray-100">
                                    <label className="text-sm font-bold text-gray-700 block mb-2 flex items-center gap-2">
                                      Evidência Obrigatória {q.is_eliminatory && <span className="px-2 py-0.5 rounded text-[10px] uppercase bg-red-100 text-red-700">Eliminatório</span>}
                                    </label>
                                    {ans?.file_url ? (
                                       <div className="flex items-center gap-3 bg-emerald-50 text-emerald-700 px-4 py-3 rounded-lg text-sm font-medium border border-emerald-100">
                                         <Check className="w-5 h-5" /> 
                                         Evidência Anexada com Sucesso
                                       </div>
                                    ) : (
                                      <div className="flex items-center gap-4">
                                        <label className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                                          <UploadCloud className="w-4 h-4" />
                                          Anexar Arquivo (PDF, JPG)
                                          <input type="file" className="hidden" onChange={(e) => handleFileUpload(q.id, e)} accept=".pdf,.jpg,.jpeg,.png" />
                                        </label>
                                      </div>
                                    )}
                                  </div>
                                )}

                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                );
              })}

              {renderList.every(r => (questionsBySection.get(r.section.id)?.length ?? 0) === 0) && (
                <div className="text-center py-24 text-gray-400">
                  <p className="text-sm max-w-md mx-auto">
                    Esta seção é de registro qualitativo (sem critérios pontuados neste roteiro).
                  </p>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
          <button 
            onClick={() => saveProgress(false)}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
          >
            {saving ? <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div> : <Save className="w-4 h-4" />}
            Salvar Rascunho
          </button>

          <div className="flex items-center gap-3">
             <button
                className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg disabled:opacity-50 flex items-center gap-1"
                disabled={activeRootIndex === 0}
                onClick={() => {
                  if (activeRootIndex > 0) setActiveSectionId(rootSections[activeRootIndex - 1].id);
                }}
             >
                <ChevronLeft className="w-4 h-4" /> Anterior
             </button>
             <button
                onClick={() => saveProgress(true)}
                disabled={saving}
                className="px-6 py-2 bg-[#00995D] hover:bg-[#007A4A] text-white font-bold rounded-lg shadow-sm flex items-center gap-2 transition-colors disabled:opacity-70"
             >
                {activeRootIndex === rootSections.length - 1 ? (
                  <>Finalizar Avaliação <Check className="w-4 h-4" /></>
                ) : (
                  <>Próxima Etapa <ChevronRight className="w-4 h-4" /></>
                )}
             </button>
          </div>
        </div>

      </div>
    </div>
  );
}
