export interface ScoreQuestion { id: number; max_score: number | string; }
export interface ScoreAnswer { answer_value?: string | null; }

/**
 * Pontuação de um roteiro. N/A ("na") é "Não Pontuado": sai do numerador E do
 * denominador (peso a considerar = 0), para não penalizar critério que
 * legitimamente não se aplica. "sim" pontua o peso máximo; qualquer outra
 * resposta (nao/em branco) pontua 0 mas conta no denominador.
 */
export function computeScore(
  questions: ScoreQuestion[],
  answers: Record<number, ScoreAnswer>,
): { score: number; maxPossible: number; percentual: number } {
  let score = 0;
  let maxPossible = 0;
  for (const q of questions) {
    const a = answers[q.id];
    if (a?.answer_value === 'na') continue;
    const pts = Number(q.max_score) || 0;
    maxPossible += pts;
    if (a?.answer_value === 'sim') score += pts;
  }
  const percentual = maxPossible > 0 ? (score / maxPossible) * 100 : 0;
  return { score, maxPossible, percentual };
}
