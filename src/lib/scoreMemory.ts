import { computeSeal } from './computeSeal.js';

export interface ScoreMemoryRow {
  question_id: number;
  code: string | null;
  dimension: string | null;
  is_eliminatory: boolean;
  max_score: number;
  answer_value: string | null;
  score_obtained: number | null;
  evidence_status: string | null;
}

export interface ScoreMemorySurvey { within_deadline: boolean }

export type Classification = 'conta' | 'na_aprovado' | 'sem_resposta';

export interface ScoreMemoryCriterion {
  question_id: number;
  code: string | null;
  dimension: string;
  is_eliminatory: boolean;
  answer_value: string | null;
  evidence_status: string | null;
  obtained: number;
  max: number;
  classification: Classification;
}

export interface ScoreMemory {
  criteria: ScoreMemoryCriterion[];
  dimensions: { dimension: string; obtained: number; max: number; pct: number }[];
  out_of_calc: { na_aprovado: string[]; sem_resposta: string[] };
  totals: { obtained: number; max: number; base_pct: number };
  bonus: number;
  bonus_pending: boolean;
  final_pct: number;
  eliminatory_failed: boolean;
  seal: string;
}

// Documento Legal soma dentro de Segurança; sem dimensão vira 'Outros'.
function consolidate(dim: string | null): string {
  if (dim === 'Documento Legal' || dim === 'Segurança') return 'Segurança';
  return dim ?? 'Outros';
}

function classify(r: ScoreMemoryRow): Classification {
  const v = (r.answer_value ?? '').toLowerCase();
  if (!v) return 'sem_resposta';
  if (v === 'na' && r.evidence_status === 'aprovado') return 'na_aprovado';
  return 'conta';
}

export function buildScoreMemory(
  rows: ScoreMemoryRow[],
  survey: ScoreMemorySurvey | null,
): ScoreMemory {
  const criteria: ScoreMemoryCriterion[] = rows.map(r => ({
    question_id: r.question_id,
    code: r.code,
    dimension: consolidate(r.dimension),
    is_eliminatory: r.is_eliminatory,
    answer_value: r.answer_value,
    evidence_status: r.evidence_status,
    obtained: Number(r.score_obtained ?? 0),
    max: Number(r.max_score),
    classification: classify(r),
  }));

  const dimMap = new Map<string, { obtained: number; max: number }>();
  let obtained = 0, max = 0;
  for (const c of criteria) {
    if (c.classification !== 'conta') continue;
    obtained += c.obtained;
    max += c.max;
    const d = dimMap.get(c.dimension) ?? { obtained: 0, max: 0 };
    d.obtained += c.obtained; d.max += c.max;
    dimMap.set(c.dimension, d);
  }

  const dimensions = Array.from(dimMap.entries()).map(([dimension, v]) => ({
    dimension, obtained: v.obtained, max: v.max,
    pct: v.max > 0 ? Math.round((v.obtained / v.max) * 1000) / 10 : 0,
  }));

  const base_pct = max > 0 ? Math.round((obtained / max) * 10000) / 100 : 0;
  const bonus = survey?.within_deadline ? 10 : 0;
  const final_pct = Math.min(100, base_pct + bonus);
  const eliminatory_failed = criteria.some(c => c.evidence_status === 'reprovado' && c.is_eliminatory);

  return {
    criteria,
    dimensions,
    out_of_calc: {
      na_aprovado: criteria.filter(c => c.classification === 'na_aprovado').map(c => c.code ?? '—'),
      sem_resposta: criteria.filter(c => c.classification === 'sem_resposta').map(c => c.code ?? '—'),
    },
    totals: { obtained, max, base_pct },
    bonus,
    bonus_pending: survey == null,
    final_pct,
    eliminatory_failed,
    seal: computeSeal(final_pct, eliminatory_failed),
  };
}
