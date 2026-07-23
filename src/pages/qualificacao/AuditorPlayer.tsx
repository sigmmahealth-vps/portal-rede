import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchApi } from '../../lib/api';
import { questionOnly } from '../../lib/questionText';
import IterationTimeline, { Iteration } from './IterationTimeline';
import {
  Check, ChevronLeft, ChevronRight, ArrowLeft, XCircle, RotateCcw,
  Loader2, Paperclip, ShieldCheck, FileText, MessageSquare,
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
  document_type?: string | null;
}

interface Section {
  id: number;
  parent_section_id: number | null;
  name: string;
  order_index: number;
}

interface Answer {
  id: number;
  question_id: number;
  answer_value: string | null;
  score_obtained: number;
  evidence_url: string | null;
  evidence_status: string | null;
  auditor_observation: string | null;
  provider_observation: string | null;
  is_non_compliant: boolean;
}

// --- Peças de UI --------------------------------------------------------------

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

// --- Semânticas de análise ---------------------------------------------------
// analisada = auditor já agiu terminalmente (aprovado/reprovado).
// pendente = respondida pelo prestador mas ainda sem ação terminal do auditor
//            (inclui 'aguardando_reanalise', bola no prestador — auditor precisa monitorar).
// total = respondidas pelo prestador (excluímos as sem resposta pra não inflar denominador).

type AnalStatus = 'analisada' | 'pendente' | 'sem_resposta';
function analStatus(a: Answer | undefined): AnalStatus {
  if (!a || !a.answer_value) return 'sem_resposta';
  if (a.evidence_status === 'aprovado' || a.evidence_status === 'reprovado') return 'analisada';
  return 'pendente';
}

const evidenceLabel = (ev: string | null | undefined): { label: string; cls: string } | null => {
  if (!ev) return null;
  if (ev === 'aprovado') return { label: 'Analisado — Aprovado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (ev === 'reprovado') return { label: 'Analisado — Reprovado', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (ev === 'aguardando_reanalise') return { label: 'Aguardando Reanálise', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
  return { label: 'Pendente de Análise', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
};

const answerPill = (v: string | null | undefined) => {
  if (v === 'sim') return { label: 'Sim', cls: 'bg-emerald-100 text-emerald-700' };
  if (v === 'nao') return { label: 'Não', cls: 'bg-red-100 text-red-700' };
  if (v === 'na') return { label: 'N/A', cls: 'bg-gray-200 text-gray-700' };
  return { label: '—', cls: 'bg-gray-100 text-gray-500' };
};

// --- Componente principal ----------------------------------------------------

export default function AuditorPlayer({
  instanceId, onClose,
}: {
  instanceId: number;
  onClose: () => void;
}) {
  const [instance, setInstance] = useState<any>(null);
  const [script, setScript] = useState<any>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answersByQ, setAnswersByQ] = useState<Record<number, Answer>>({});
  const [filesByQ, setFilesByQ] = useState<Record<number, { id: number; url: string }[]>>({});
  const [itersByAnswer, setItersByAnswer] = useState<Record<number, Iteration[]>>({});
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reasonPrompt, setReasonPrompt] = useState<{ answerId: number; action: 'aprovou' | 'reprovou' | 'solicitou_reanalise' } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [revising, setRevising] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const inst = await fetchApi(`/eval/instances/${instanceId}`);
      const sc = await fetchApi(`/eval/scripts/${inst.script_id}`);
      const allSections: Section[] = sc.sections || [];
      const allQuestions: Question[] = sc.questions || [];
      // Mesma poda de grupos qualitativos do RoteiroPlayer, pra alinhar navegação.
      const childMap = new Map<number | null, Section[]>();
      for (const s of allSections) {
        const k = s.parent_section_id ?? null;
        const arr = childMap.get(k);
        if (arr) arr.push(s); else childMap.set(k, [s]);
      }
      const secWithQ = new Set(allQuestions.map(q => q.section_id));
      const subtreeHasQ = (id: number): boolean =>
        secWithQ.has(id) || (childMap.get(id) ?? []).some(c => subtreeHasQ(c.id));
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

      const map: Record<number, Answer> = {};
      (inst.answers || []).forEach((a: Answer) => { map[a.question_id] = a; });

      // Agrupa evidências por question_id (uma answer pode ter múltiplos anexos).
      const files: Record<number, { id: number; url: string }[]> = {};
      for (const ev of inst.evidences ?? []) {
        if (ev.question_id == null) continue;
        const bucket = files[ev.question_id] ?? (files[ev.question_id] = []);
        bucket.push({ id: Number(ev.id), url: ev.file_url });
      }
      // Fallback pro anexo em eval_answers.evidence_url (bypass DL grava só ali).
      for (const a of inst.answers ?? []) {
        if (a.evidence_url && !(files[a.question_id]?.length)) {
          files[a.question_id] = [{ id: -a.id, url: a.evidence_url }];
        }
      }

      // Iterations agrupadas por answer_id.
      const iters: Record<number, Iteration[]> = {};
      for (const it of (inst.iterations ?? []) as Iteration[]) {
        (iters[it.answer_id] ??= []).push(it);
      }

      setInstance(inst);
      setScript(sc);
      setSections(visibleSections);
      setQuestions(allQuestions);
      setAnswersByQ(map);
      setFilesByQ(files);
      setItersByAnswer(iters);
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar avaliação');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [instanceId]);

  // Primeira macro-seção ao carregar.
  useEffect(() => {
    if (!sections.length) return;
    const groups = computeStepGroups(sections, questions);
    setActiveSectionId(prev => (prev && groups.some(g => g.id === prev)) ? prev : (groups[0]?.id ?? null));
  }, [sections, questions]);

  // Árvore ---------------------------------------------------------------------
  const childrenByParent = useMemo(() => {
    const m = new Map<number | null, Section[]>();
    for (const s of sections) {
      const k = s.parent_section_id ?? null;
      const arr = m.get(k);
      if (arr) arr.push(s); else m.set(k, [s]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.order_index - b.order_index);
    return m;
  }, [sections]);

  const questionsBySection = useMemo(() => {
    const m = new Map<number, Question[]>();
    for (const q of questions) {
      const arr = m.get(q.section_id);
      if (arr) arr.push(q); else m.set(q.section_id, [q]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.order_index - b.order_index);
    return m;
  }, [questions]);

  const descendantSectionIds = (rootId: number): number[] => {
    const ids: number[] = [];
    const walk = (id: number) => { ids.push(id); for (const c of childrenByParent.get(id) ?? []) walk(c.id); };
    walk(rootId);
    return ids;
  };

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

  // Progresso global (todas as respondidas — sem resposta não conta na base) ---
  const globalStats = useMemo(() => {
    let total = 0, analisadas = 0, pendentes = 0;
    for (const q of questions) {
      const st = analStatus(answersByQ[q.id]);
      if (st === 'sem_resposta') continue;
      total++;
      if (st === 'analisada') analisadas++;
      else pendentes++;
    }
    return { total, analisadas, pendentes, pct: total ? (analisadas / total) * 100 : 0 };
  }, [questions, answersByQ]);

  const canFinish = globalStats.pendentes === 0 && globalStats.total > 0;

  // Ações do auditor ----------------------------------------------------------
  const act = async (answerId: number, action: 'aprovou' | 'reprovou' | 'solicitou_reanalise', observation?: string) => {
    setBusy(true);
    const path = action === 'aprovou' ? 'aprovar' : action === 'reprovou' ? 'reprovar' : 'solicitar-reanalise';
    try {
      await fetchApi(`/eval/answers/${answerId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observation: observation || '' }),
      });
      await load();
      setRevising(prev => { const n = new Set(prev); n.delete(answerId); return n; });
    } catch (e: any) {
      alert(e?.message || 'Erro na ação');
    } finally {
      setBusy(false);
      setReasonPrompt(null);
      setReasonText('');
    }
  };

  const emitirParecer = async () => {
    if (!confirm('Emitir parecer final? Isto fecha a avaliação e calcula o selo.')) return;
    setBusy(true);
    try {
      const res = await fetchApi(`/eval/instances/${instanceId}/parecer`, { method: 'POST' });
      alert(`Parecer emitido: selo ${res.seal} (${Number(res.percentual).toFixed(2)}%)`);
      onClose();
    } catch (e: any) {
      alert(e?.message || 'Erro ao emitir parecer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-20 flex flex-col bg-[#f4f4f4] lg:left-20">

      <header className="shrink-0 border-b border-gray-200 bg-[#f4f4f4]">
        <div className="mx-auto w-full max-w-7xl px-4 pb-4 pt-3 sm:px-6">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-emerald-700"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao Painel do Ciclo
          </button>

          <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <span>Auditoria</span>
                <ChevronRight className="h-3 w-3" />
                <span className="max-w-[18rem] truncate">{instance?.provider_name || '—'}</span>
                {activeRoot && (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    <span className="max-w-[18rem] truncate text-emerald-700">{activeRoot.name}</span>
                  </>
                )}
              </nav>
              <h1 className="mt-1 text-pretty text-2xl font-bold text-secondary-900">
                {activeRoot?.name || instance?.provider_name || 'Análise da Avaliação'}
              </h1>
              {instance && (
                <p className="mt-1 text-xs text-gray-500">
                  {script?.title}
                  {instance.location_label ? <> · {instance.location_label}</> : null}
                </p>
              )}
            </div>

            <button
              onClick={emitirParecer}
              disabled={busy || loading || !canFinish}
              title={!canFinish ? 'Analise todos os critérios respondidos antes de emitir o parecer.' : 'Emitir parecer final'}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Emitir Parecer Final
            </button>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">

          {/* Resumo mobile */}
          {!loading && (
            <div className="mb-6 flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 lg:hidden">
              <Donut value={globalStats.pct} size={60} stroke={7} />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Progresso da análise</p>
                <p className="text-sm font-semibold text-secondary-900">
                  {globalStats.analisadas} de {globalStats.total} critérios analisados
                </p>
                <p className="text-xs text-gray-500">{globalStats.pendentes} pendente(s)</p>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">

            <main className="min-w-0 space-y-6">
              {loading ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : (() => {
                const groupQs = renderList.flatMap(({ section }) => (questionsBySection.get(section.id) ?? []));
                const stats = { total: 0, analisadas: 0, pendentes: 0 };
                for (const q of groupQs) {
                  const st = analStatus(answersByQ[q.id]);
                  if (st === 'sem_resposta') continue;
                  stats.total++;
                  if (st === 'analisada') stats.analisadas++;
                  else stats.pendentes++;
                }
                const matches = (q: Question) => {
                  const st = analStatus(answersByQ[q.id]);
                  if (st === 'sem_resposta') return false;
                  if (statusFilter === 'pending') return st === 'pendente';
                  if (statusFilter === 'done') return st === 'analisada';
                  return true;
                };
                const filterTabs = [
                  { key: 'all',     label: 'Todas',      count: stats.total },
                  { key: 'pending', label: 'Pendentes',  count: stats.pendentes },
                  { key: 'done',    label: 'Analisadas', count: stats.analisadas },
                ] as const;
                const totalVisible = groupQs.filter(matches).length;

                if (groupQs.length === 0) {
                  return (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center">
                      <p className="mx-auto max-w-md text-sm text-gray-500">
                        Esta seção é de registro qualitativo — não há critérios para o auditor pontuar.
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="min-w-0 space-y-6">
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
                          {statusFilter === 'pending'
                            ? 'Nada pendente neste grupo — tudo analisado.'
                            : statusFilter === 'done'
                              ? 'Nenhum critério analisado ainda neste grupo.'
                              : 'Nenhum critério respondido pelo prestador neste grupo.'}
                        </p>
                      </div>
                    )}

                    {renderList.map(({ section: renderSec, depth }) => {
                      const allSecQuestions = questionsBySection.get(renderSec.id) ?? [];
                      const secQuestions = allSecQuestions.filter(matches);
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
                            const a = answersByQ[q.id];
                            const evLabel = evidenceLabel(a?.evidence_status);
                            const ansPill = answerPill(a?.answer_value);
                            const terminal = a?.evidence_status === 'aprovado' || a?.evidence_status === 'reprovado';
                            const awaitingProvider = a?.evidence_status === 'aguardando_reanalise';
                            const bypass = (a?.auditor_observation || '').includes('Aprovado via cadastro');
                            const showPrompt = reasonPrompt?.answerId === a?.id;

                            return (
                              <article
                                key={q.id}
                                className={`rounded-2xl border bg-white p-5 shadow-sm transition-shadow sm:p-6 ${
                                  a?.evidence_status === 'reprovado'
                                    ? 'border-red-200'
                                    : a?.evidence_status === 'aprovado'
                                      ? 'border-emerald-200'
                                      : 'border-gray-200 hover:shadow-md'
                                }`}
                              >
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
                                    {q.document_type && (
                                      <span className="rounded border border-secondary-200 bg-secondary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-700">
                                        DL — {q.document_type}
                                      </span>
                                    )}
                                    {q.is_eliminatory && (
                                      <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                                        Eliminatório
                                      </span>
                                    )}
                                  </div>

                                  {evLabel && (
                                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${evLabel.cls}`}>
                                      {evLabel.label}
                                    </span>
                                  )}
                                </div>

                                <h4 className="text-pretty text-base font-medium leading-snug text-secondary-900">
                                  {questionOnly(q.text)}
                                </h4>
                                {q.legislation && (
                                  <p className="mt-1.5 text-xs font-medium text-gray-400">{q.legislation}</p>
                                )}

                                {/* Resposta do prestador */}
                                <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                    Resposta do prestador
                                  </p>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-md px-2.5 py-0.5 text-xs font-bold ${ansPill.cls}`}>
                                      {ansPill.label}
                                    </span>
                                    {bypass && (
                                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                        Atendido via cadastro
                                      </span>
                                    )}
                                  </div>
                                  {(() => {
                                    const files = filesByQ[q.id] ?? [];
                                    if (!files.length) return null;
                                    return (
                                      <ul className="mt-2 space-y-1">
                                        {files.map((f, i) => {
                                          const name = f.url.split('/').pop() || `anexo-${i + 1}`;
                                          return (
                                            <li key={f.id}>
                                              <a
                                                href={f.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                                              >
                                                <Paperclip className="h-3 w-3 shrink-0" />
                                                <span className="truncate">{name}</span>
                                              </a>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    );
                                  })()}
                                  {a?.provider_observation && (
                                    <p className="mt-2 flex gap-1.5 text-xs italic text-gray-600">
                                      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                                      "{a.provider_observation}"
                                    </p>
                                  )}
                                </div>

                                {/* Observação prévia do auditor */}
                                {a?.auditor_observation && !bypass && (
                                  <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-secondary-900">
                                    <span className="font-semibold">Observação do auditor: </span>
                                    <span className="italic">"{a.auditor_observation}"</span>
                                  </div>
                                )}

                                {/* Ações do auditor */}
                                {!a ? (
                                  <p className="mt-4 text-xs italic text-gray-400">Prestador ainda não respondeu — nada a analisar.</p>
                                ) : (() => {
                                  const isRevising = revising.has(a.id);
                                  const locked = terminal && !isRevising;
                                  if (locked) {
                                    return (
                                      <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <span className="text-xs text-gray-500">Ação já registrada.</span>
                                        <button
                                          type="button"
                                          onClick={() => setRevising(prev => new Set(prev).add(a.id))}
                                          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" /> Rever decisão
                                        </button>
                                      </div>
                                    );
                                  }
                                  // Em revisão de decisão, mesmo "Aprovar" exige justificativa.
                                  const approveNeedsReason = isRevising;
                                  return (
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        disabled={busy || awaitingProvider}
                                        title={awaitingProvider ? 'Aguardando o prestador reenviar a evidência.' : undefined}
                                        onClick={() => approveNeedsReason
                                          ? (setReasonPrompt({ answerId: a.id, action: 'aprovou' }), setReasonText(''))
                                          : act(a.id, 'aprovou')}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <Check className="h-3.5 w-3.5" strokeWidth={3} /> Aprovar
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy || awaitingProvider}
                                        title={awaitingProvider ? 'Aguardando o prestador reenviar a evidência.' : undefined}
                                        onClick={() => { setReasonPrompt({ answerId: a.id, action: 'reprovou' }); setReasonText(''); }}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <XCircle className="h-3.5 w-3.5" /> Reprovar
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => { setReasonPrompt({ answerId: a.id, action: 'solicitou_reanalise' }); setReasonText(''); }}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 shadow-sm transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" /> {awaitingProvider ? 'Ajustar orientação' : 'Solicitar reanálise'}
                                      </button>
                                      {isRevising && (
                                        <button
                                          type="button"
                                          onClick={() => setRevising(prev => { const n = new Set(prev); n.delete(a.id); return n; })}
                                          className="text-xs text-gray-500 underline"
                                        >
                                          Cancelar revisão
                                        </button>
                                      )}
                                      {awaitingProvider && !isRevising && (
                                        <span className="ml-2 text-xs text-amber-800">Aguardando reenvio do prestador.</span>
                                      )}
                                    </div>
                                  );
                                })()}

                                {a && <IterationTimeline items={itersByAnswer[a.id] ?? []} />}

                                {showPrompt && a && (() => {
                                  const act2 = reasonPrompt!.action;
                                  const label = act2 === 'aprovou' ? 'Justificativa da revisão'
                                    : act2 === 'reprovou' ? 'Motivo da reprovação'
                                    : 'Orientação para reanálise';
                                  const placeholder = act2 === 'aprovou' ? 'Explique por que está revendo a decisão anterior.'
                                    : act2 === 'reprovou' ? 'Descreva por que o critério foi reprovado.'
                                    : 'Descreva o que o prestador deve corrigir/enviar.';
                                  return (
                                    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                                      <label className="mb-1 block text-xs font-semibold text-secondary-900">
                                        {label} <span className="font-normal text-red-600">(obrigatório)</span>
                                      </label>
                                      <textarea
                                        value={reasonText}
                                        onChange={e => setReasonText(e.target.value)}
                                        rows={2}
                                        placeholder={placeholder}
                                        className="w-full rounded-lg border border-gray-300 p-2.5 text-sm text-secondary-900 placeholder:text-gray-400 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                                      />
                                      <div className="mt-2 flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => { setReasonPrompt(null); setReasonText(''); }}
                                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                        >
                                          Cancelar
                                        </button>
                                        <button
                                          type="button"
                                          disabled={!reasonText.trim() || busy}
                                          onClick={() => act(a.id, act2, reasonText.trim())}
                                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
                                        >
                                          Confirmar
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </article>
                            );
                          })}
                        </section>
                      );
                    })}
                  </div>
                );
              })()}

              {!loading && (
                <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                  <button
                    onClick={() => { if (activeRootIndex > 0) { setActiveSectionId(rootSections[activeRootIndex - 1].id); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); } }}
                    disabled={activeRootIndex <= 0}
                    className="inline-flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Seção anterior
                  </button>
                  <button
                    onClick={() => {
                      if (isLastRoot) { emitirParecer(); }
                      else { setActiveSectionId(rootSections[activeRootIndex + 1].id); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }
                    }}
                    disabled={busy || (isLastRoot && !canFinish)}
                    title={isLastRoot && !canFinish ? 'Analise todos os critérios antes de emitir o parecer.' : undefined}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isLastRoot
                      ? (<>Emitir parecer final <ShieldCheck className="h-4 w-4" /></>)
                      : (<>Próxima seção <ChevronRight className="h-4 w-4" /></>)}
                  </button>
                </div>
              )}
            </main>

            {/* Rail lateral — progresso e stepper por seção */}
            <aside className="hidden lg:block">
              <div className="sticky top-0 max-h-[calc(100vh-10rem)] space-y-4 overflow-y-auto pr-1">
                <p className="px-1 text-sm font-bold text-secondary-900 truncate">
                  {instance?.provider_name || 'Auditoria'}
                </p>
                <div className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex items-center gap-4">
                    <Donut value={globalStats.pct} />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Análise</p>
                      <p className="text-sm font-semibold text-secondary-900">{globalStats.analisadas} de {globalStats.total}</p>
                      <p className="text-xs text-gray-500">{globalStats.pendentes} pendente(s)</p>
                    </div>
                  </div>
                </div>

                <nav className="space-y-1 rounded-2xl border border-gray-200 bg-white p-2">
                  {rootSections.map(sec => {
                    const isActive = sec.id === activeSectionId;
                    const famIds = descendantSectionIds(sec.id);
                    const secQs = questions.filter(q => famIds.includes(q.section_id));
                    let secTotal = 0, secDone = 0;
                    for (const q of secQs) {
                      const st = analStatus(answersByQ[q.id]);
                      if (st === 'sem_resposta') continue;
                      secTotal++;
                      if (st === 'analisada') secDone++;
                    }
                    return (
                      <button
                        key={sec.id}
                        onClick={() => { setActiveSectionId(sec.id); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                          isActive ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-gray-50'
                        }`}
                      >
                        <MiniRing done={secDone} total={secTotal} active={isActive} />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-semibold leading-tight ${isActive ? 'text-emerald-800' : 'text-secondary-900'}`}>
                            {sec.name}
                          </span>
                          <span className={`mt-0.5 block text-xs ${isActive ? 'text-emerald-700' : 'text-gray-500'}`}>
                            {secDone}/{secTotal} analisados
                          </span>
                          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                            <span
                              className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
                              style={{ width: `${secTotal ? (secDone / secTotal) * 100 : 0}%` }}
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
