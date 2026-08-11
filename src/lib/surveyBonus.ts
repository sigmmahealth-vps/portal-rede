// Prazo e bônus da Pesquisa de Satisfação (spec 5.4.6).
export const SURVEY_DEADLINE_DAYS = 7;

/** Fim do prazo = envio do roteiro + 7 dias corridos. */
export function surveyDeadline(roteiroSubmittedAt: Date): Date {
  const d = new Date(roteiroSubmittedAt.getTime());
  d.setUTCDate(d.getUTCDate() + SURVEY_DEADLINE_DAYS);
  return d;
}

/** True se `at` está dentro do prazo (inclusive a borda exata dos 7 dias). */
export function isWithinDeadline(roteiroSubmittedAt: Date, at: Date): boolean {
  return at.getTime() <= surveyDeadline(roteiroSubmittedAt).getTime();
}

/** Bônus percentual aplicado ao selo. */
export function bonusPoints(withinDeadline: boolean): number {
  return withinDeadline ? 10 : 0;
}
