// Autorização de escrita do PRESTADOR sobre uma avaliação (spec 5.4.2 / D-04).
// Staff (admin/auditoria) não passa por aqui — tem fluxo próprio.

// Estados em que o prestador ainda edita a avaliação. Fora disso (em_analise,
// aprovado, reprovado, finalizado, ciclo_encerrado) ele não escreve nada.
export const PROVIDER_EDIT_STATUSES = new Set([
  'pendente', 'em_andamento', 'aguardando_evidencia',
]);

// D-04: quando a instância volta pra reanálise (aguardando_evidencia), APENAS o
// critério em reavaliação pode ser alterado. Isso é:
//   - o critério devolvido agora pelo auditor ('aguardando_reanalise'); ou
//   - o mesmo critério já reeditado nesta rodada — vira 'pendente' ao salvar, mas
//     tem histórico de reanálise (everReanalise), então segue editável.
// Ficam TRAVADOS: os já decididos ('aprovado'/'reprovado') e os de 1ª rodada nunca
// analisados ('pendente' sem histórico de reanálise). everReanalise = existe uma
// iteração 'solicitou_reanalise' para o critério. Nos demais estados de edição
// (pendente/em_andamento, preenchimento inicial), tudo liberado.
export function providerCanEditCriterion(
  instanceStatus: string,
  evidenceStatus: string | null,
  everReanalise = false,
): boolean {
  if (!PROVIDER_EDIT_STATUSES.has(instanceStatus)) return false;
  if (instanceStatus === 'aguardando_evidencia') {
    if (evidenceStatus === 'aguardando_reanalise') return true;
    if (evidenceStatus === 'pendente') return everReanalise;
    return false;
  }
  return true;
}
