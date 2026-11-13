// Status efetivo de um documento de gestão documental, derivado de status + validade.
// Puro: usado no cliente (lista) e no servidor (export). 'historico' é marcado para a
// lista escondê-lo. Compara só a data (YYYY-MM-DD), sem fuso.
export type StatusDoc = 'pendente' | 'aprovado' | 'vencido' | 'reprovado' | 'historico';

export function statusDocumento(
  doc: { status: string; expiry_date: string | null | undefined },
  hoje: Date = new Date(),
): StatusDoc {
  if (doc.status === 'historico') return 'historico';
  if (doc.status === 'pendente') return 'pendente';
  if (doc.status === 'reprovado') return 'reprovado';
  // valido ou vencido: decide pela data de validade.
  const hojeStr = hoje.toISOString().slice(0, 10);
  if (doc.expiry_date && doc.expiry_date < hojeStr) return 'vencido';
  if (doc.status === 'vencido') return 'vencido';
  return 'aprovado';
}
