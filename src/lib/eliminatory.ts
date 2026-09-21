// src/lib/eliminatory.ts
// Critérios eliminatórios configuráveis por roteiro (spec 2026-09-21). Lógica pura, sem I/O.

export type CriterionRef = { code: string | null; text: string };
export type PrevCriterion = CriterionRef & { is_eliminatory: boolean };
export type CurrentCriterion = { id: number; code: string | null; is_eliminatory: boolean };

/**
 * Chave de casamento de um critério entre versões do roteiro: code + texto
 * normalizado. `code` sozinho não serve — repete dentro do mesmo roteiro
 * (6 de 15 planilhas) e pode ser NULL.
 */
export function criterionKey(c: CriterionRef): string {
  const text = c.text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${c.code ?? ''}|${text}`;
}

/**
 * Marcações que a nova versão herda da anterior. Só herda `true` quando TODAS as
 * ocorrências da chave na versão anterior estavam marcadas (chave repetida com
 * marcações divergentes é ambígua). `lost` = marcações que não foram
 * transportadas (critério removido, texto alterado ou ambíguo) — para revisão.
 */
export function inheritEliminatory(
  prev: PrevCriterion[], next: CriterionRef[],
): { flags: boolean[]; lost: CriterionRef[] } {
  const byKey = new Map<string, boolean[]>();
  for (const p of prev) {
    const k = criterionKey(p);
    byKey.set(k, [...(byKey.get(k) ?? []), p.is_eliminatory]);
  }
  const flags = next.map(n => byKey.get(criterionKey(n))?.every(Boolean) ?? false);
  const carried = new Set(next.filter((_, i) => flags[i]).map(criterionKey));
  const lost = prev
    .filter(p => p.is_eliminatory && !carried.has(criterionKey(p)))
    .map(({ code, text }) => ({ code, text }));
  return { flags, lost };
}

/** Diferença entre as marcações atuais e o conjunto desejado (ids marcados). */
export function diffEliminatory(current: CurrentCriterion[], markedIds: number[]) {
  const ids = new Set(current.map(c => c.id));
  const marked = new Set(markedIds);
  return {
    unknownIds: markedIds.filter(id => !ids.has(id)),
    toMark: current.filter(c => !c.is_eliminatory && marked.has(c.id)),
    toUnmark: current.filter(c => c.is_eliminatory && !marked.has(c.id)),
  };
}

// Item de plano de ação "eliminatório" = marcação ATUAL do critério de origem
// (decisão Q9-B da spec). Sem answer_id (ON DELETE SET NULL) cai na regra antiga.
// Assumem o alias `it` para eval_action_items.
// ponytail: lê a flag da versão do roteiro usada naquele ciclo; desmarcar numa
// revisão nova não alcança planos antigos (contorno: editar a versão anterior).
// Upgrade: congelar is_eliminatory em eval_action_items na geração do plano.
// O `false` final cobre item manual (sem answer_id e sem dimension): sem ele o
// BOOL_OR daria NULL e o plano pendente deixaria de ser sinalizado.
// ponytail: marcar um critério é retroativo sobre planos pendentes de ciclos
// anteriores (passam a travar Bronze). Upgrade: o mesmo congelamento acima.
export const PLAN_ITEM_QUESTION_JOIN_SQL = `
  LEFT JOIN eval_answers ea_it ON ea_it.id = it.answer_id
  LEFT JOIN eval_questions eq_it ON eq_it.id = ea_it.question_id`;
export const PLAN_ITEM_ELIMINATORY_SQL =
  `COALESCE(eq_it.is_eliminatory, it.dimension = 'Documento Legal', false)`;
