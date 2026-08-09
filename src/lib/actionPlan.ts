// src/lib/actionPlan.ts
// Lógica pura do Plano de Ação 5W2H (spec 5.4.4). Sem I/O — testável sem banco.

export const DUE_SOON_DAYS = 15;
export const ITEM_DEFAULT_TERM_DAYS = 90;

const DAY_MS = 86_400_000;

/** 3 janelas trimestrais a partir da criação do plano (+90/+180/+270 dias). */
export function computeWindows(planCreatedAt: Date): Date[] {
  return [1, 2, 3].map(n => new Date(planCreatedAt.getTime() + n * ITEM_DEFAULT_TERM_DAYS * DAY_MS));
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
  legislation: string | null; dimension: string | null;
  is_non_compliant: boolean; evidence_status: string | null; guidance: string | null;
};

export type AutoItem = {
  answer_id: number; question_code: string | null; question_text: string;
  dimension: string | null; is_mandatory: boolean;
  what: string; why: string; how: string | null;
};

/** Gera os itens candidatos do plano a partir das respostas do parecer (5.4.4.1). */
export function buildAutoItems(
  answers: AnswerForPlan[],
  ctx: { segurancaPct: number },
): AutoItem[] {
  const nonCompliant = answers.filter(
    a => a.is_non_compliant || a.evidence_status === 'reprovado',
  );
  const segMandatory = ctx.segurancaPct < 60;
  return nonCompliant.map(a => {
    const isDL = a.dimension === 'Documento Legal';
    const isSeg = a.dimension === 'Segurança';
    return {
      answer_id: a.id,
      question_code: a.question_code,
      question_text: a.question_text,
      dimension: a.dimension,
      is_mandatory: isDL || (isSeg && segMandatory),
      what: `Adequar o critério: ${a.question_text}`,
      why: a.legislation
        ? `Critério não atendido na avaliação. Embasamento: ${a.legislation}`
        : 'Critério não atendido na avaliação do ciclo de qualificação.',
      how: a.guidance,
    };
  });
}
