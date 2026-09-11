// Catálogo de textos das notificações (spec 5.4.7). Puro: sem DB, sem env.
// O link é relativo; o server prefixa APP_URL no corpo do e-mail.

export const NOTIFY_TYPES = [
  'ciclo_aberto', 'ciclo_reaberto', 'roteiro_enviado', 'reanalise_solicitada',
  'parecer_aprovado', 'parecer_reprovado', 'certificado_emitido',
  'plano_gerado', 'acao_aguardando_validacao',
  'acao_vencendo', 'acao_atrasada', 'roteiro_pendente', 'certificado_vencendo',
  'ciclo_encerrado_sem_avaliacao',
] as const;
export type NotifyType = typeof NOTIFY_TYPES[number];

export interface NotifyContent { title: string; body: string; link: string; }

import { fmtData, fmtPct } from './formatDate';
export const fmtDate = fmtData;

export function dedupeKey(type: string, ref: string, dest: string | number): string {
  return `${type}:${ref}:${dest}`;
}

// Marco do lembrete de roteiro pendente pelos dias até o fim do ciclo.
// 'fim' quando o prazo chegou/passou (daysLeft <= 0); senão 7 ou 30 dias.
// null fora da janela (mais de 30 dias). Cada marco dispara um aviso próprio.
export type RoteiroReminderMarco = '30' | '7' | 'fim';
export function roteiroReminderMarco(daysLeft: number): RoteiroReminderMarco | null {
  if (daysLeft <= 0) return 'fim';
  if (daysLeft <= 7) return '7';
  if (daysLeft <= 30) return '30';
  return null;
}

export function renderNotification(type: NotifyType, ctx: Record<string, any> = {}): NotifyContent {
  const link = '/qualificacao';
  switch (type) {
    case 'ciclo_aberto':
      return { title: `Ciclo de qualificação ${ctx.cycle_label ?? ''} aberto`.replace(/\s+/g, ' ').trim(),
               body: `Seu roteiro de qualificação está disponível para preenchimento no portal.${ctx.end_date ? ` O prazo para envio termina em ${fmtDate(ctx.end_date)}.` : ''}`, link };
    case 'ciclo_reaberto':
      return { title: `Ciclo ${ctx.cycle_label ?? ''} reaberto — prazo prorrogado`.replace(/\s+/g, ' ').trim(),
               body: `O ciclo de qualificação foi reaberto e você pode concluir sua avaliação até ${fmtDate(ctx.end_date)}.`, link };
    case 'roteiro_enviado':
      return { title: 'Roteiro enviado para análise',
               body: `${ctx.provider_name ?? 'Um prestador'} enviou o roteiro de qualificação para análise.`, link };
    case 'reanalise_solicitada': {
      const prazoRe = ctx.end_date ? ` O prazo para reenvio termina em ${fmtDate(ctx.end_date)}.` : '';
      return ctx.integral
        ? { title: 'Avaliação devolvida para reanálise',
            body: `O auditor devolveu sua avaliação. Revise os critérios apontados e reenvie.${prazoRe}`, link }
        : { title: `Reanálise solicitada — critério ${ctx.question_code ?? ''}`.trim(),
            body: `O auditor solicitou reanálise de um critério da sua avaliação. Ajuste a evidência e reenvie.${prazoRe}`, link };
    }
    case 'parecer_aprovado':
      return { title: `Avaliação aprovada — selo ${ctx.seal ?? ''}`.trim(),
               body: `Sua avaliação de qualificação foi aprovada com ${fmtPct(ctx.percentual ?? 0)} de atingimento. Veja o parecer no portal.`, link };
    case 'parecer_reprovado':
      return { title: 'Avaliação concluída — não qualificado',
               body: 'Sua avaliação foi concluída sem atingir os requisitos do selo. Veja o parecer e o plano de ação no portal.', link };
    case 'certificado_emitido':
      return { title: 'Certificado de qualificação emitido',
               body: `Seu certificado está disponível no portal. Validade: ${fmtDate(ctx.valid_until)}.`, link };
    case 'plano_gerado':
      return { title: `Plano de ação gerado${ctx.provider_name ? ` — ${ctx.provider_name}` : ''}`,
               body: ctx.items
                 ? `Um plano de ação com ${ctx.items} ação(ões) foi gerado. Acompanhe os prazos no portal.`
                 : 'Um plano de ação foi criado para acompanhamento. Acesse o portal.', link };
    case 'acao_aguardando_validacao':
      return { title: `Ação concluída aguardando validação${ctx.provider_name ? ` — ${ctx.provider_name}` : ''}`,
               body: `O prestador concluiu a ação "${ctx.what ?? ''}" e aguarda validação do auditor.`, link };
    case 'acao_vencendo':
      return { title: 'Ação do plano próxima do vencimento',
               body: `A ação "${ctx.what ?? ''}" vence em ${fmtDate(ctx.due_date)}.`, link };
    case 'acao_atrasada':
      return { title: `Ação do plano em atraso${ctx.provider_name ? ` — ${ctx.provider_name}` : ''}`,
               body: `A ação "${ctx.what ?? ''}" venceu em ${fmtDate(ctx.due_date)} e não foi concluída.`, link };
    case 'roteiro_pendente':
      if (ctx.digest)
        return { title: `${ctx.count ?? 0} roteiro(s) pendente(s) — ciclo ${ctx.cycle_label ?? ''} encerra em ${fmtDate(ctx.end_date)}`,
                 body: 'Há prestadores que ainda não enviaram o roteiro de qualificação. Veja o painel do ciclo.', link };
      if (ctx.marco === 'fim')
        return { title: `Último dia — o ciclo encerra hoje (${fmtDate(ctx.end_date)})`,
                 body: 'Hoje é o último dia para enviar seu roteiro de qualificação. Após o encerramento do ciclo não será mais possível enviar.', link };
      if (ctx.marco === '7')
        return { title: `Roteiro pendente — faltam 7 dias (ciclo encerra em ${fmtDate(ctx.end_date)})`,
                 body: 'Faltam 7 dias para o encerramento do ciclo e você ainda não enviou seu roteiro de qualificação.', link };
      return { title: `Roteiro pendente — o ciclo encerra em ${fmtDate(ctx.end_date)}`,
               body: 'Você ainda não enviou seu roteiro de qualificação. O prazo termina junto com o ciclo.', link };
    case 'certificado_vencendo':
      return { title: 'Certificado próximo do vencimento',
               body: `Seu certificado de qualificação vence em ${fmtDate(ctx.valid_until)}.`, link };
    case 'ciclo_encerrado_sem_avaliacao':
      return { title: `Ciclo ${ctx.cycle_label ?? ''} encerrado — avaliação não concluída`.replace(/\s+/g, ' ').trim(),
               body: 'O ciclo de qualificação foi encerrado e a sua avaliação não foi concluída a tempo. Aguarde a abertura do próximo ciclo para se qualificar.', link };
    default:
      return { title: String(type), body: '', link };
  }
}
