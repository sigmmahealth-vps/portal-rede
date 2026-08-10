// src/pages/qualificacao/planoStatus.ts
export const PLAN_STATUS_LABEL: Record<string, string> = {
  aberto: 'Em aberto', em_andamento: 'Em andamento',
  aguardando_revisao: 'A validar', a_vencer: 'A vencer',
  atrasado: 'Atrasado', concluido: 'Concluído',
  encerrado_sem_conclusao: 'Encerrado sem conclusão',
};
export const PLAN_COLOR_CLASS: Record<string, string> = {
  verde: 'bg-emerald-100 text-emerald-800',
  azul: 'bg-blue-100 text-blue-800',
  laranja: 'bg-orange-100 text-orange-800',
  vermelho: 'bg-red-100 text-red-800',
  cinza: 'bg-gray-100 text-gray-600',
};
export const ITEM_STATUS_LABEL: Record<string, string> = {
  nao_iniciada: 'Não iniciada', em_andamento: 'Em andamento',
  aguardando_revisao: 'Aguardando revisão', solicitada_revisao: 'Solicitada revisão',
  reprovada: 'Reprovada', concluida: 'Concluída',
};
