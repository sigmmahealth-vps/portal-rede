/**
 * Rótulos de status conforme spec 5.4.2.2. Único mapa canônico.
 * Fallback: se um status desconhecido chegar, mostra a string original.
 */
export const STATUS_LABEL: Record<string, string> = {
  pendente:              'Pendente',
  em_andamento:          'Em Preenchimento',
  em_analise:            'Em Análise',
  aguardando_evidencia:  'Aguardando Reanálise',
  aprovado:              'Concluído — Aprovado',
  reprovado:             'Concluído — Aprovado',
  finalizado:            'Concluído — Aprovado',
  ciclo_encerrado:       'Ciclo Encerrado',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}
