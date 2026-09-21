// src/lib/actionPlan.ts
// Lógica pura do Plano de Ação 5W2H (spec 5.4.4). Sem I/O — testável sem banco.

// Controle 30/60/90 (pedido Unimed 2026-09, antes 90/180/270 com alerta a 15 dias).
// Vale só para planos novos: os existentes mantêm o due_date gravado na criação.
export const DUE_SOON_DAYS = 7;
export const ITEM_DEFAULT_TERM_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * 3 janelas mensais a partir da criação do plano (+30/+60/+90 dias).
 * O plano não pode ultrapassar o início do próximo ciclo (lá o prestador é
 * reavaliado): se `nextCycleStart` chegar mais perto que 3 meses, as janelas se
 * distribuem por igual entre a criação e esse limite (a 3ª termina nele). Sem
 * próximo ciclo, mantém os 90 dias cheios.
 */
export function computeWindows(planCreatedAt: Date, nextCycleStart?: Date | null): Date[] {
  const fullSpan = 3 * ITEM_DEFAULT_TERM_DAYS * DAY_MS; // 90 dias
  const capSpan = nextCycleStart ? nextCycleStart.getTime() - planCreatedAt.getTime() : Infinity;
  const span = Math.min(fullSpan, capSpan > 0 ? capSpan : fullSpan);
  return [1, 2, 3].map(n => new Date(planCreatedAt.getTime() + (span * n) / 3));
}

export type ItemLike = { status: string; due_date: string | null };

export type PlanStatus =
  | 'aberto' | 'em_andamento' | 'aguardando_revisao'
  | 'a_vencer' | 'atrasado' | 'concluido' | 'encerrado_sem_conclusao';

const OPEN_ITEM = new Set(['nao_iniciada', 'em_andamento', 'solicitada_revisao', 'reprovada']);

export function computePlanStatus(args: {
  items: ItemLike[];
  hasProviderInteraction: boolean;
  closedWithoutCompletion: boolean;
  now: Date;
}): PlanStatus {
  const { items, hasProviderInteraction, closedWithoutCompletion, now } = args;
  if (closedWithoutCompletion) return 'encerrado_sem_conclusao';
  if (items.length > 0 && items.every(i => i.status === 'concluida')) return 'concluido';

  const open = items.filter(i => i.status !== 'concluida');
  const dueDates = open
    .filter(i => OPEN_ITEM.has(i.status) && i.due_date)
    .map(i => new Date(i.due_date + 'T23:59:59Z').getTime());

  if (dueDates.length) {
    const nearest = Math.min(...dueDates);
    if (nearest < now.getTime()) return 'atrasado';
    if (nearest - now.getTime() <= DUE_SOON_DAYS * DAY_MS) return 'a_vencer';
  }
  if (open.some(i => i.status === 'aguardando_revisao')) return 'aguardando_revisao';
  if (hasProviderInteraction || open.some(i => i.status !== 'nao_iniciada')) return 'em_andamento';
  return 'aberto';
}

/** Cores do painel do auditor (spec 5.4.4.5). */
export function planColor(status: PlanStatus): 'verde' | 'azul' | 'laranja' | 'vermelho' | 'cinza' {
  switch (status) {
    case 'em_andamento': return 'verde';
    case 'aberto':
    case 'aguardando_revisao': return 'azul';
    case 'a_vencer': return 'laranja';
    case 'atrasado': return 'vermelho';
    default: return 'cinza'; // concluido / encerrado_sem_conclusao
  }
}

export type AnswerForPlan = {
  id: number; question_code: string | null; question_text: string;
  legislation: string | null; dimension: string | null; is_eliminatory: boolean;
  answer_value: string | null; score_obtained: number | string; max_score: number | string;
  guidance: string | null;
};

export type AutoItem = {
  answer_id: number; question_code: string | null; question_text: string;
  dimension: string | null; is_mandatory: boolean;
  what: string; why: string; how: string | null;
};

/**
 * Critério "não pontuou": não atingiu a nota máxima, excluindo NA. É objetivo —
 * não depende do flag aprovar/reprovar do auditor. Assim uma DL não enviada que o
 * auditor "aprovou" (reconhecendo a não conformidade, score 0) ainda gera plano.
 */
export function naoPontuou(a: Pick<AnswerForPlan, 'answer_value' | 'score_obtained' | 'max_score'>): boolean {
  if ((a.answer_value ?? '').toLowerCase() === 'na') return false;
  return Number(a.score_obtained) < Number(a.max_score);
}

/** Gera os itens candidatos do plano a partir das respostas do parecer (5.4.4.1). */
export function buildAutoItems(
  answers: AnswerForPlan[],
  ctx: { segurancaPct: number },
): AutoItem[] {
  const nonCompliant = answers.filter(naoPontuou);
  const segMandatory = ctx.segurancaPct < 60;
  return nonCompliant.map(a => {
    // Obrigatório = critério eliminatório (marcação do roteiro, spec 2026-09-21) ou
    // Segurança < 60%. Documento Legal consolida em Segurança (mesma base do segurancaPct).
    const isSeg = a.dimension === 'Segurança' || a.dimension === 'Documento Legal';
    return {
      answer_id: Number(a.id), // pg retorna bigint como string; Number() evita Set.has() falso-negativo
      question_code: a.question_code,
      question_text: a.question_text,
      dimension: a.dimension,
      is_mandatory: !!a.is_eliminatory || (isSeg && segMandatory),
      what: `Adequar o critério: ${a.question_text}`,
      why: a.legislation
        ? `Critério não atendido na avaliação. Embasamento: ${a.legislation}`
        : 'Critério não atendido na avaliação do ciclo de qualificação.',
      how: a.guidance,
    };
  });
}
