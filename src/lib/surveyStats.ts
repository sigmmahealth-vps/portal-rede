// Indicadores da Pesquisa de Satisfação (spec 5.4.6): NPS, CSAT e distribuições.
export interface SurveyRow {
  q1_clareza: number | null;
  q2_portal: number | null;
  q3_documentos: string | null;
  q4_dificuldade: boolean | null;
  q5_geral: number | null;
  q6_nps: number | null;
}

export interface SurveyStats {
  count: number;
  nps: { promoters: number; passives: number; detractors: number; score: number | null };
  csat: { q1: number | null; q2: number | null; q5: number | null };
  q3: Record<string, number>;
  q4DifficultyPct: number | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (!nums.length) return null;
  return round1(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function computeSurveyStats(rows: SurveyRow[]): SurveyStats {
  const nps = rows.map(r => r.q6_nps).filter((v): v is number => v != null);
  const promoters = nps.filter(v => v >= 9).length;
  const detractors = nps.filter(v => v <= 6).length;
  const passives = nps.length - promoters - detractors;
  const score = nps.length
    ? Math.round(((promoters - detractors) / nps.length) * 100)
    : null;

  const q3: Record<string, number> = {};
  for (const r of rows) if (r.q3_documentos) q3[r.q3_documentos] = (q3[r.q3_documentos] ?? 0) + 1;

  const q4 = rows.map(r => r.q4_dificuldade).filter((v): v is boolean => v != null);
  const q4DifficultyPct = q4.length
    ? round1((q4.filter(Boolean).length / q4.length) * 100)
    : null;

  return {
    count: rows.length,
    nps: { promoters, passives, detractors, score },
    csat: {
      q1: mean(rows.map(r => r.q1_clareza)),
      q2: mean(rows.map(r => r.q2_portal)),
      q5: mean(rows.map(r => r.q5_geral)),
    },
    q3,
    q4DifficultyPct,
  };
}
