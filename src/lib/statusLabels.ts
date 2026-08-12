/**
 * Rótulos de status conforme spec 5.4.2.2. Único mapa canônico.
 * Fallback: se um status desconhecido chegar, mostra a string original.
 */
export const STATUS_LABEL: Record<string, string> = {
  pendente:              'Pendente',
  em_andamento:          'Em Preenchimento',
  em_analise:            'Em Análise',
  aguardando_evidencia:  'Reanálise',
  aprovado:              'Concluído',
  reprovado:             'Concluído',
  finalizado:            'Concluído',
  ciclo_encerrado:       'Ciclo Encerrado',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}
