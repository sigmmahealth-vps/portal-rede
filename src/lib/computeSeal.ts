export type Seal = 'Ouro' | 'Prata' | 'Bronze';

/**
 * Selo da qualificação (spec 5.4.2.3). Faixas exatas:
 *   Acima de 90,00% → Ouro     (sem eliminatório não conforme)
 *   De 60,01% a 90,00% → Prata (sem eliminatório não conforme)
 *   Até 60,00% → Bronze
 * Regra adicional: qualquer eliminatório não conforme rebaixa a Bronze (a definição de
 * "não conformidade" está em scoreMemory.ts — DL que não pontuou o máximo, não só o reprovado).
 * A spec não define o que fazer quando percentual > 60% com eliminatório não conforme —
 * decisão de produto: rebaixa a Bronze (nota alta não compensa eliminatório).
 */
export function computeSeal(percentual: number, hasEliminatoryFailed: boolean): Seal {
  if (hasEliminatoryFailed) return 'Bronze';
  if (percentual > 90.00) return 'Ouro';
  if (percentual > 60.00) return 'Prata';
  return 'Bronze';
}
