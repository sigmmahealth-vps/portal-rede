// Autorização de escrita do PRESTADOR sobre uma avaliação (spec 5.4.2 / D-04).
// Staff (admin/auditoria) não passa por aqui — tem fluxo próprio.

// Estados em que o prestador ainda edita a avaliação. Fora disso (em_analise,
// aprovado, reprovado, finalizado, ciclo_encerrado) ele não escreve nada.
export const PROVIDER_EDIT_STATUSES = new Set([
  'pendente', 'em_andamento', 'aguardando_evidencia',
]);

// D-04: quando a instância volta pra reanálise (aguardando_evidencia), o prestador
// só pode mexer nos critérios que o auditor devolveu (evidence_status
// 'aguardando_reanalise') ou que ele já começou a reeditar ('pendente'). Critérios
// 'aprovado'/'reprovado' ficam travados. Nos demais estados de edição, tudo liberado.
export function providerCanEditCriterion(
  instanceStatus: string,
  evidenceStatus: string | null,
): boolean {
  if (!PROVIDER_EDIT_STATUSES.has(instanceStatus)) return false;
  if (instanceStatus === 'aguardando_evidencia') {
    return evidenceStatus === 'aguardando_reanalise' || evidenceStatus === 'pendente';
  }
  return true;
}
