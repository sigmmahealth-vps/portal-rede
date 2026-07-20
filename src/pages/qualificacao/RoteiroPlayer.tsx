import React, { useState, useEffect, useRef } from 'react';
import { fetchApi } from '../../lib/api';
import { computeScore } from '../../lib/score';
import { questionOnly } from '../../lib/questionText';
import {
  Check, ChevronLeft, ChevronRight, ArrowLeft, UploadCloud,
  AlertTriangle, Save, Loader2, Paperclip, Eye, Trash2,
} from 'lucide-react';

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

interface EvidenceFile {
  id: number;
  url: string;
}

interface Answer {
  answer_value: string;
  score_obtained: number;
  files?: EvidenceFile[];
  is_na?: boolean;
  provider_observation?: string;
}

// --- Peças de UI --------------------------------------------------------------

/** Donut de progresso com o percentual no centro. */
function Donut({ value, size = 76, stroke = 8 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#00995d" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold text-secondary-900">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

/** Indicador de seção no stepper: anel de fração, ou ✓ quando completa. */
function MiniRing({ done, total, active }: { done: number; total: number; active: boolean }) {
  const complete = total > 0 && done >= total;
  if (complete) {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  }
  const size = 28, stroke = 3, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const value = total > 0 ? done / total : 0;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={active ? '#00995d' : '#9ca3af'}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - value)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
    </span>
  );
}

const DIM_STYLES: Record<string, string> = {
  'Segurança': 'bg-sky-50 text-sky-700 border-sky-200',
  'Conforto': 'bg-violet-50 text-violet-700 border-violet-200',
  'Experiência do Cliente': 'bg-amber-50 text-amber-700 border-amber-200',
};
const dimClass = (d?: string | null) =>
  (d && DIM_STYLES[d]) || 'bg-gray-100 text-gray-600 border-gray-200';

const SECTION_RE = /^\s*se[çc][ãa]o\s+\d/i;

/**
 * Grupos de navegação do stepper = as macro-seções do roteiro.
 * Alguns roteiros têm um grupo-raiz acima das seções (ex.: "INFRAESTRUTURA E
 * PROCESSOS" > SEÇÃO 1/2/3). Quando existem nós nomeados "SEÇÃO N", eles são os
 * grupos; senão, caímos nas raízes que têm critérios. Sempre com critérios na subárvore.
 */
function computeStepGroups(sections: Section[], questions: Question[]): Section[] {
  const childrenByParent = new Map<number | null, Section[]>();
  for (const s of sections) {
    const k = s.parent_section_id ?? null;
    const arr = childrenByParent.get(k);
    if (arr) arr.push(s); else childrenByParent.set(k, [s]);
  }
  const secWithQ = new Set(questions.map(q => q.section_id));
  const subtreeHasQ = (id: number): boolean =>
    secWithQ.has(id) || (childrenByParent.get(id) ?? []).some(c => subtreeHasQ(c.id));

  const named = sections.filter(s => SECTION_RE.test(s.name) && subtreeHasQ(s.id));
  const groups = named.length
    ? named
    : (childrenByParent.get(null) ?? []).filter(s => subtreeHasQ(s.id));
  return [...groups].sort((a, b) => a.order_index - b.order_index);
}

// Textarea com state local: só propaga no blur (ou Ctrl/Cmd+Enter). Assim o card
// não sai de "Pendente" a cada tecla — só quando o usuário termina a observação.
function ObservationField({
  initial, placeholder, onCommit,
}: { initial: string; placeholder: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(initial);
  // Se o valor externo mudar (ex.: recarga), sincroniza — mas só quando o usuário
  // não está editando ativamente (draft ainda igual ao initial antigo).
  const lastInitialRef = useRef(initial);
  useEffect(() => {
    if (initial !== lastInitialRef.current) {
      setDraft(initial);
      lastInitialRef.current = initial;
    }
  }, [initial]);
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
      }}
      rows={2}
      placeholder={placeholder}
      className="w-full rounded-lg border border-gray-300 p-2.5 text-sm text-secondary-900 placeholder:text-gray-400 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
    />
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="animate-pulse space-y-4">
        <div className="flex gap-2">
          <div className="h-5 w-12 rounded bg-gray-200" />
          <div className="h-5 w-24 rounded bg-gray-200" />
        </div>
        <div className="h-4 w-3/4 rounded bg-gray-200" />
        <div className="h-9 w-56 rounded-xl bg-gray-100" />
      </div>
    </div>
  );
}

// --- Componente principal -----------------------------------------------------

export default function RoteiroPlayer({
  scriptId,
  instanceId,
  locationId,
  onClose,
  providerId,
  readOnly = false,
}: {
  scriptId: number;
  instanceId?: number;
  locationId?: number;
  onClose: () => void;
  providerId: number;
  readOnly?: boolean;
}) {
  const [script, setScript] = useState<any>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Real instance ID (if we started a new one)
  const [currentInstanceId, setCurrentInstanceId] = useState<number | null>(instanceId || null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadScript();
  }, [scriptId]);

  // Seleciona a primeira macro-seção ao carregar (ou se a seleção sair de sincronia).
  useEffect(() => {
    if (!sections.length) return;
    const groups = computeStepGroups(sections, questions);
    setActiveSectionId(prev => (prev && groups.some(g => g.id === prev)) ? prev : (groups[0]?.id ?? null));
  }, [sections, questions]);

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
      // A seleção da primeira macro-seção é feita no useEffect (computeStepGroups).

      if (instanceId) {
        const instanceData = await fetchApi(`/eval/instances/${instanceId}`);
        const loadedAnswers: Record<number, Answer> = {};
        // Agrupa evidências (múltiplos anexos por question_id) do array `evidences`.
        const filesByQuestion: Record<number, EvidenceFile[]> = {};
        for (const ev of instanceData.evidences ?? []) {
          if (ev.question_id == null) continue;
          const bucket = filesByQuestion[ev.question_id] ?? (filesByQuestion[ev.question_id] = []);
          bucket.push({ id: Number(ev.id), url: ev.file_url });
        }
        if (instanceData.answers) {
          instanceData.answers.forEach((ans: any) => {
            loadedAnswers[ans.question_id] = {
              answer_value: ans.answer_value,
              score_obtained: ans.score_obtained,
              files: filesByQuestion[ans.question_id] ?? [],
              provider_observation: ans.provider_observation || undefined,
            };
          });
        }
        // Perguntas com evidências mas sem answer_value (raro; salvaguarda).
        for (const qId of Object.keys(filesByQuestion).map(Number)) {
          if (!loadedAnswers[qId]) loadedAnswers[qId] = { answer_value: '', score_obtained: 0, files: filesByQuestion[qId] };
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
        score_obtained: score,
      },
    }));
  };

  const handleObservationChange = (questionId: number, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { ...prev[questionId], provider_observation: value },
    }));
  };

  const handleFileUpload = async (questionId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Precisamos de uma instância p/ anexar; cria sob demanda se ainda não existe.
    let instId = currentInstanceId;
    if (!instId) {
      try {
        const { id } = await fetchApi('/eval/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script_id: scriptId, provider_id: providerId, location_id: locationId ?? null }),
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
    formData.append('question_id', questionId.toString());

    try {
      const res = await fetchApi(`/eval/instances/${instId}/evidence`, {
        method: 'POST',
        body: formData,
      });
      setAnswers(prev => {
        const cur = prev[questionId] ?? { answer_value: '', score_obtained: 0 };
        return {
          ...prev,
          [questionId]: { ...cur, files: [...(cur.files ?? []), { id: Number(res.id), url: res.url }] },
        };
      });
    } catch (err) {
      alert('Erro ao fazer upload da evidência');
    } finally {
      // permite reanexar o mesmo arquivo em sequência
      e.target.value = '';
    }
  };

  const handleFileDelete = async (questionId: number, docId: number) => {
    if (!currentInstanceId) return;
    if (!window.confirm('Remover este anexo?')) return;
    try {
      await fetchApi(`/eval/instances/${currentInstanceId}/evidence/${docId}`, { method: 'DELETE' });
      setAnswers(prev => {
        const cur = prev[questionId];
        if (!cur) return prev;
        return { ...prev, [questionId]: { ...cur, files: (cur.files ?? []).filter(f => f.id !== docId) } };
      });
    } catch (err: any) {
      alert(err.message || 'Erro ao remover anexo');
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
          body: JSON.stringify({ script_id: scriptId, provider_id: providerId, location_id: locationId ?? null }),
        });
        instId = id;
        setCurrentInstanceId(id);
      }

      const answersArray = Object.keys(answers).map(qId => ({
        question_id: parseInt(qId),
        answer_value: answers[parseInt(qId)].answer_value,
        score_obtained: answers[parseInt(qId)].score_obtained,
        provider_observation: answers[parseInt(qId)].provider_observation || null,
        is_non_compliant: (answers[parseInt(qId)].answer_value === 'nao' || answers[parseInt(qId)].answer_value === 'NAO') ? 1 : 0,
      }));

      await fetchApi(`/eval/instances/${instId}/answers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: answersArray }),
      });

      if (!goToNext) {
        alert('Progresso salvo com sucesso!');
      } else {
        const roots = computeStepGroups(sections, questions);
        const currentIndex = roots.findIndex(s => s.id === activeSectionId);
        if (currentIndex !== -1 && currentIndex < roots.length - 1) {
          setActiveSectionId(roots[currentIndex + 1].id);
          scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (currentIndex === roots.length - 1) {
          const pend = pendingItems();
          if (pend.length > 0) {
            alert(`Há ${pend.length} critério(s) pendente(s) (sem resposta, evidência ou justificativa). Complete-os antes de finalizar.`);
            return;
          }
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
    const { score: totalScore, maxPossible: maxScore, percentual } = computeScore(questions, answers);
    try {
      await fetchApi(`/eval/instances/${instId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'pendente', // Enviado para auditoria
          score: totalScore,
          max_possible_score: maxScore,
          percentual: percentual,
        }),
      });
      alert('Avaliação concluída e enviada com sucesso!');
      onClose();
    } catch (err) {
      alert('Erro ao concluir avaliação');
    }
  };

  // --- Cálculos de árvore/estado (independem do estado de loading) -------------

  // Os roteiros têm hierarquia de profundidade variável (grupo → seção → subseção → critério).
  // order_index é relativo aos irmãos, então a ordem correta só emerge andando a árvore.
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

  const descendantSectionIds = (rootId: number): number[] => {
    const ids: number[] = [];
    const walk = (id: number) => { ids.push(id); for (const c of childrenByParent.get(id) ?? []) walk(c.id); };
    walk(rootId);
    return ids;
  };

  // Grupos do stepper = macro-seções (SEÇÃO 1/2/3), não o grupo-raiz que às vezes as envolve.
  const rootSections = computeStepGroups(sections, questions);
  const activeRootIndex = rootSections.findIndex(s => s.id === activeSectionId);
  const activeRoot = rootSections[activeRootIndex] ?? rootSections[0];
  const isLastRoot = activeRootIndex === rootSections.length - 1;

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

  const isAnswered = (q: Question) => !!answers[q.id]?.answer_value;
  const answeredCount = questions.filter(isAnswered).length;
  const progressPct = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  // Pendência = critério sem resposta OU resposta sem o requisito da opção:
  //   Sim → precisa de evidência SÓ quando q.evidence_required=true
  //   Não / N/A → precisa de observação (texto)
  const pendingItems = () => questions.filter(q => {
    const a = answers[q.id];
    if (!a?.answer_value) return true;
    if (a.answer_value === 'sim') return q.evidence_required && !(a.files && a.files.length > 0);
    return !a.provider_observation?.trim();
  });
  // ponytail: um Set por render (não por card) — evita o O(n²) de chamar pendingItems() no map.
  const pendingSet = new Set(pendingItems().map(q => q.id));

  const emptyGroup = renderList.every(r => (questionsBySection.get(r.section.id)?.length ?? 0) === 0);

  const answerOptions = [
    { v: 'sim', label: 'Sim', on: 'bg-emerald-500 text-white shadow-sm', score: (q: Question) => Number(q.max_score) || 0 },
    { v: 'nao', label: 'Não', on: 'bg-red-500 text-white shadow-sm', score: () => 0 },
    { v: 'na', label: 'Não se aplica', on: 'bg-gray-600 text-white shadow-sm', score: () => 0 },
  ] as const;

  return (
    // Painel de trabalho: cobre a área de conteúdo (abaixo do topo do portal, à direita do menu).
    // Cabeçalho e rail ficam fixos; o scroll é interno, só nos itens.
    <div className="fixed inset-x-0 bottom-0 top-16 z-20 flex flex-col bg-[#f4f4f4] lg:left-20">

      {/* Cabeçalho fixo (fora do scroll) */}
      <header className="shrink-0 border-b border-gray-200 bg-[#f4f4f4]">
        <div className="mx-auto w-full max-w-7xl px-4 pb-4 pt-3 sm:px-6">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar aos meus roteiros
        </button>

        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <span>Qualificação</span>
              <ChevronRight className="h-3 w-3" />
              <span className="max-w-[18rem] truncate">{script?.title || 'Roteiro'}</span>
              {activeRoot && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span className="max-w-[18rem] truncate text-emerald-700">{activeRoot.name}</span>
                </>
              )}
            </nav>
            <h1 className="mt-1 text-pretty text-2xl font-bold text-secondary-900">
              {activeRoot?.name || script?.title || 'Roteiro de Qualificação'}
            </h1>
          </div>

          {readOnly ? (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-500">
              <Eye className="h-4 w-4" /> Somente leitura — avaliação enviada
            </span>
          ) : (
            <button
              onClick={() => saveProgress(false)}
              disabled={saving || loading}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar e continuar depois
            </button>
          )}
        </div>
        </div>
      </header>

      {/* Corpo com scroll — só os itens rolam; cabeçalho e rail ficam fixos. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">

          {/* Resumo de progresso (mobile — o rail vira faixa no topo) */}
          {!loading && (
            <div className="mb-6 flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 lg:hidden">
              <Donut value={progressPct} size={60} stroke={7} />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Progresso</p>
                <p className="text-sm font-semibold text-secondary-900">
                  {answeredCount} de {questions.length} critérios
                </p>
                <p className="text-xs text-gray-500">respondidos</p>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">

        {/* Conteúdo principal */}
        <main className="min-w-0 space-y-6">
          {loading ? (
            <>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </>
          ) : emptyGroup ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center">
              <p className="mx-auto max-w-md text-sm text-gray-500">
                Esta seção é de registro qualitativo — não há critérios para o prestador pontuar neste roteiro.
              </p>
            </div>
          ) : (() => {
            // Contadores por status para o grupo atual (macro-seção selecionada).
            const groupQs = renderList.flatMap(({ section }) => questionsBySection.get(section.id) ?? []);
            const groupPending = groupQs.filter(q => pendingSet.has(q.id)).length;
            const groupDone = groupQs.length - groupPending;
            const filterMatches = (q: Question) => {
              if (statusFilter === 'pending') return pendingSet.has(q.id);
              if (statusFilter === 'done') return !pendingSet.has(q.id);
              return true;
            };
            const filterTabs = [
              { key: 'all',     label: 'Todas',       count: groupQs.length },
              { key: 'pending', label: 'Pendentes',   count: groupPending },
              { key: 'done',    label: 'Respondidas', count: groupDone },
            ] as const;
            const totalVisible = groupQs.filter(filterMatches).length;
            return (
            <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-6 border-0 p-0">
            {/* Filtro de status — aplica a todas as (sub)seções do grupo atual. */}
            <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
              {filterTabs.map(t => {
                const active = statusFilter === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setStatusFilter(t.key)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                      active ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {t.label}
                    <span className={`inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                      active ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {totalVisible === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
                <p className="text-sm text-gray-500">
                  {statusFilter === 'pending' ? 'Nenhum item pendente neste grupo — bom trabalho!' : 'Nenhum item respondido ainda.'}
                </p>
              </div>
            )}

            {renderList.map(({ section: renderSec, depth }) => {
              const allSecQuestions = questionsBySection.get(renderSec.id) ?? [];
              const secQuestions = allSecQuestions.filter(filterMatches);
              const showHeader = depth >= 1;
              if (secQuestions.length === 0 && !showHeader) return null;
              if (secQuestions.length === 0 && statusFilter !== 'all') return null;

              return (
                <section key={renderSec.id} className="space-y-4">
                  {showHeader && (depth === 1 ? (
                    <h2 className="text-pretty border-b border-gray-200 pb-2 text-lg font-bold text-secondary-900">
                      {renderSec.name}
                    </h2>
                  ) : (
                    <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {renderSec.name}
                    </h3>
                  ))}

                  {secQuestions.map(q => {
                    const ans = answers[q.id];
                    const value = ans?.answer_value;
                    const isSim = value === 'sim';
                    const isNao = value === 'nao';
                    const isNa = value === 'na';
                    const answered = !!value;
                    const pending = pendingSet.has(q.id);

                    return (
                      <article
                        key={q.id}
                        className={`rounded-2xl border bg-white p-5 shadow-sm transition-shadow sm:p-6 ${
                          isNao ? 'border-red-200' : 'border-gray-200 hover:shadow-md'
                        }`}
                      >
                        {/* Linha de meta: código + dimensão + status */}
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {q.code && (
                              <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold text-gray-700">
                                {q.code}
                              </span>
                            )}
                            {q.dimension && (
                              <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${dimClass(q.dimension)}`}>
                                {q.dimension}
                              </span>
                            )}
                            {/* ponytail: badge DL acende quando o parser passar a emitir type='DL' (adiado). */}
                            {q.type === 'DL' && (
                              <span className="rounded border border-secondary-200 bg-secondary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-700">
                                DL — Documentação Legal
                              </span>
                            )}
                            {q.is_eliminatory && (
                              <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                                Eliminatório
                              </span>
                            )}
                          </div>

                          {answered && !pending ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              <Check className="h-3.5 w-3.5" strokeWidth={3} /> Respondido
                            </span>
                          ) : (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              <span className="h-2.5 w-2.5 rounded-full border-2 border-amber-500" /> Pendente
                            </span>
                          )}
                        </div>

                        <h4 className="text-pretty text-base font-medium leading-snug text-secondary-900">
                          {questionOnly(q.text)}
                        </h4>
                        {q.legislation && (
                          <p className="mt-1.5 text-xs font-medium text-gray-400">
                            {q.legislation}
                          </p>
                        )}
                        {q.guidance && (
                          <p className="mt-2 text-xs leading-relaxed text-gray-500">
                            <span className="font-semibold text-gray-600">Evidência esperada: </span>{q.guidance}
                          </p>
                        )}

                        {/* Resposta segmentada Sim / Não / N/A */}
                        {q.type === 'sim_nao' && (
                          <div className="mt-4 flex w-fit rounded-xl border border-gray-200 bg-gray-50 p-1" role="group" aria-label="Resposta">
                            {answerOptions.map(opt => {
                              const selected = value === opt.v;
                              return (
                                <button
                                  key={opt.v}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => handleAnswerChange(q.id, opt.v, opt.score(q))}
                                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                                    selected ? opt.on : 'text-gray-600 hover:text-gray-900'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Não conformidade */}
                        {isNao && (
                          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                            <p className="text-xs text-red-700">
                              <span className="font-semibold">Não conformidade identificada.</span> Este item entrará no plano de ação após a análise.
                            </p>
                          </div>
                        )}

                        {/* Observação obrigatória para Não e N/A */}
                        {(isNao || isNa) && (
                          <div className="mt-4">
                            <label className="mb-1 block text-sm font-semibold text-secondary-900">
                              {isNa ? 'Justificativa' : 'Observação'}{' '}
                              <span className="font-normal text-red-600">(obrigatória)</span>
                              <span className="ml-2 text-xs font-normal text-gray-400">
                                — salva ao sair do campo (ou Ctrl+Enter)
                              </span>
                            </label>
                            <ObservationField
                              initial={ans?.provider_observation || ''}
                              placeholder={
                                isNa
                                  ? 'Explique por que este critério não se aplica ao seu estabelecimento.'
                                  : 'Descreva o motivo da não conformidade.'
                              }
                              onCommit={(v) => handleObservationChange(q.id, v)}
                            />
                          </div>
                        )}

                        {/* Evidências obrigatórias para Sim (só quando o critério exige) */}
                        {isSim && q.evidence_required && (() => {
                          const files = ans?.files ?? [];
                          return (
                            <div className="mt-4 border-t border-gray-100 pt-4">
                              <p className="mb-2 text-sm font-semibold text-secondary-900">
                                Evidências <span className="font-normal text-red-600">(pelo menos uma)</span>
                              </p>
                              {files.length > 0 && (
                                <ul className="mb-3 space-y-1.5">
                                  {files.map((f) => {
                                    const name = f.url.split('/').pop() || 'anexo';
                                    return (
                                      <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                                        <a
                                          href={f.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700 hover:underline"
                                        >
                                          <Paperclip className="h-4 w-4 shrink-0" />
                                          <span className="truncate">{name}</span>
                                        </a>
                                        <button
                                          type="button"
                                          onClick={() => handleFileDelete(q.id, f.id)}
                                          className="shrink-0 rounded-md p-1 text-emerald-700/70 transition-colors hover:bg-emerald-100 hover:text-red-600"
                                          title="Remover anexo"
                                          aria-label="Remover anexo"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-700">
                                <UploadCloud className="h-5 w-5" />
                                {files.length > 0 ? 'Adicionar outro arquivo' : 'Anexar arquivo (PDF, JPG ou PNG · até 20 MB)'}
                                <input type="file" className="hidden" onChange={(e) => handleFileUpload(q.id, e)} accept=".pdf,.jpg,.jpeg,.png" />
                              </label>
                            </div>
                          );
                        })()}
                      </article>
                    );
                  })}
                </section>
              );
            })}
            </fieldset>
            );
          })()}

          {/* Navegação entre seções */}
          {!loading && !emptyGroup && (
            <div className="flex items-center justify-between border-t border-gray-200 pt-4">
              <button
                onClick={() => { if (activeRootIndex > 0) { setActiveSectionId(rootSections[activeRootIndex - 1].id); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); } }}
                disabled={activeRootIndex <= 0}
                className="inline-flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </button>
              <button
                onClick={() => {
                  if (readOnly) {
                    if (!isLastRoot) { setActiveSectionId(rootSections[activeRootIndex + 1].id); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }
                  } else {
                    saveProgress(true);
                  }
                }}
                disabled={saving || (readOnly && isLastRoot)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isLastRoot ? (<>Finalizar avaliação <Check className="h-4 w-4" strokeWidth={3} /></>) : (<>Próxima etapa <ChevronRight className="h-4 w-4" /></>)}
              </button>
            </div>
          )}
        </main>

        {/* Rail de progresso (desktop) — fixo enquanto os itens rolam. */}
        <aside className="hidden lg:block">
          {/* Fixo no topo do corpo com scroll; rola internamente se houver muitas seções. */}
          <div className="sticky top-0 max-h-[calc(100vh-10rem)] space-y-4 overflow-y-auto pr-1">
            <p className="px-1 text-sm font-bold text-secondary-900">{script?.title || 'Roteiro de Qualificação'}</p>
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-4">
                <Donut value={progressPct} />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Progresso</p>
                  <p className="text-sm font-semibold text-secondary-900">{answeredCount} de {questions.length}</p>
                  <p className="text-xs text-gray-500">critérios respondidos</p>
                </div>
              </div>
            </div>

            <nav className="space-y-1 rounded-2xl border border-gray-200 bg-white p-2">
              {rootSections.map(sec => {
                const isActive = sec.id === activeSectionId;
                const famIds = descendantSectionIds(sec.id);
                const secQs = questions.filter(q => famIds.includes(q.section_id));
                const done = secQs.filter(isAnswered).length;
                return (
                  <button
                    key={sec.id}
                    onClick={() => { setActiveSectionId(sec.id); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      isActive ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <MiniRing done={done} total={secQs.length} active={isActive} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold leading-tight ${isActive ? 'text-emerald-800' : 'text-secondary-900'}`}>
                        {sec.name}
                      </span>
                      <span className={`mt-0.5 block text-xs ${isActive ? 'text-emerald-700' : 'text-gray-500'}`}>{done}/{secQs.length} critérios</span>
                      <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <span
                          className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
                          style={{ width: `${secQs.length ? (done / secQs.length) * 100 : 0}%` }}
                        />
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
