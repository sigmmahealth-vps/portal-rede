// Validade dos certificados é escolhida na criação do ciclo (eval_cycles.cert_valid_until)
// e deve ser igual ou posterior ao fim do ciclo. Não há mais regra automática de cálculo.
// Compara datas em YYYY-MM-DD (date-only), sem fuso.
export function certValidUntilOk(certValidUntil: string, endDate: string): boolean {
  const cvu = String(certValidUntil).slice(0, 10);
  const end = String(endDate).slice(0, 10);
  return cvu >= end; // ordenação lexicográfica de ISO date == ordenação cronológica
}
