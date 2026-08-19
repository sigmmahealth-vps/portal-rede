// Catálogo de textos das notificações (spec 5.4.7). Puro: sem DB, sem env.
// O link é relativo; o server prefixa APP_URL no corpo do e-mail.

export const NOTIFY_TYPES = [
  'ciclo_aberto', 'roteiro_enviado', 'reanalise_solicitada',
  'parecer_aprovado', 'parecer_reprovado', 'certificado_emitido',
  'plano_gerado', 'acao_aguardando_validacao',
  'acao_vencendo', 'acao_atrasada', 'roteiro_pendente', 'certificado_vencendo',
] as const;
export type NotifyType = typeof NOTIFY_TYPES[number];

export interface NotifyContent { title: string; body: string; link: string; }

// Datas date-only ('YYYY-MM-DD') ganham T12:00 para não voltar um dia por fuso.
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T12:00:00` : v) : v;
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

export function dedupeKey(type: string, ref: string, dest: string | number): string {
  return `${type}:${ref}:${dest}`;
}

export function renderNotification(type: NotifyType, ctx: Record<string, any> = {}): NotifyContent {
  const link = '/qualificacao';
  switch (type) {
    case 'ciclo_aberto':
      return { title: `Ciclo de qualificação ${ctx.cycle_label ?? ''} aberto`.replace(/\s+/g, ' ').trim(),
               body: 'Seu roteiro de qualificação está disponível para preenchimento no portal.', link };
    case 'roteiro_enviado':
      return { title: 'Roteiro enviado para análise',
               body: `${ctx.provider_name ?? 'Um prestador'} enviou o roteiro de qualificação para análise.`, link };
    case 'reanalise_solicitada':
      return ctx.integral
        ? { title: 'Avaliação devolvida para reanálise',
            body: 'O auditor devolveu sua avaliação. Revise os critérios apontados e reenvie.', link }
        : { title: `Reanálise solicitada — critério ${ctx.question_code ?? ''}`.trim(),
            body: 'O auditor solicitou reanálise de um critério da sua avaliação. Ajuste a evidência e reenvie.', link };
    case 'parecer_aprovado':
      return { title: `Avaliação aprovada — selo ${ctx.seal ?? ''}`.trim(),
               body: `Sua avaliação de qualificação foi aprovada com ${Math.round(Number(ctx.percentual ?? 0))}% de atingimento. Veja o parecer no portal.`, link };
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
      return ctx.digest
        ? { title: `${ctx.count ?? 0} roteiro(s) pendente(s) — ciclo ${ctx.cycle_label ?? ''} encerra em ${fmtDate(ctx.end_date)}`,
            body: 'Há prestadores que ainda não enviaram o roteiro de qualificação. Veja o painel do ciclo.', link }
        : { title: `Roteiro pendente — o ciclo encerra em ${fmtDate(ctx.end_date)}`,
            body: 'Você ainda não enviou seu roteiro de qualificação. O prazo termina junto com o ciclo.', link };
    case 'certificado_vencendo':
      return { title: 'Certificado próximo do vencimento',
               body: `Seu certificado de qualificação vence em ${fmtDate(ctx.valid_until)}.`, link };
    default:
      return { title: String(type), body: '', link };
  }
}
