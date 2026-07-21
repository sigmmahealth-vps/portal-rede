export type Seal = 'Ouro' | 'Prata' | 'Bronze';

/**
 * Selo da qualificação (spec 5.4.2.3). Faixas exatas:
 *   Acima de 90,00% → Ouro     (sem eliminatório reprovado)
 *   De 60,01% a 90,00% → Prata (sem eliminatório reprovado)
 *   Até 60,00% → Bronze
 * Regra adicional: qualquer eliminatório reprovado rebaixa a Bronze.
 * A spec não define o que fazer quando percentual > 60% com eliminatório reprovado —
 * decisão de produto: rebaixa a Bronze (nota alta não compensa eliminatório).
 */
export function computeSeal(percentual: number, hasEliminatoryFailed: boolean): Seal {
  if (hasEliminatoryFailed) return 'Bronze';
  if (percentual > 90.00) return 'Ouro';
  if (percentual > 60.00) return 'Prata';
  return 'Bronze';
}
