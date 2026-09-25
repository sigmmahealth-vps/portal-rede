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

// Destino do clique (sininho e botão do e-mail). Homologação 25/09: todo aviso abre a
// Qualificação na aba inicial — Início (prestador) ou Estratégico (auditoria), pelo
// default de cada visão. O mapa por tipo (?aba=…, ?corrigir=…) está no histórico (8b62b78).
export function notifyLink(_type: string, _ctx: Record<string, any> = {}): string {
  return '/qualificacao';
}

// Aviso de manual (spec 2026-09-24): só texto — o arquivo é baixado dentro do portal, nunca por link/anexo.
export const MANUAL_TXT = ' O manual do seu roteiro está disponível no portal, em Meus Roteiros.';

export function renderNotification(type: NotifyType, ctx: Record<string, any> = {}): NotifyContent {
  const link = notifyLink(type, ctx);
  switch (type) {
    case 'ciclo_aberto':
      return { title: `Ciclo de qualificação ${ctx.cycle_label ?? ''} aberto`.replace(/\s+/g, ' ').trim(),
               body: `Seu roteiro de qualificação está disponível para preenchimento no portal.${ctx.end_date ? ` O prazo para envio termina em ${fmtDate(ctx.end_date)}.` : ''}${ctx.has_manual ? MANUAL_TXT : ''}`, link };
    case 'ciclo_reaberto':
      // prorrogado = admin informou nova data de fim; senão é reabertura no mesmo prazo.
      return ctx.prorrogado
        ? { title: ctx.cycle_label ? `Ciclo prorrogado — ${ctx.cycle_label}` : 'Ciclo prorrogado',
            body: `O prazo do ciclo de qualificação foi prorrogado até ${fmtDate(ctx.end_date)}. Conclua e envie sua avaliação até essa data.`, link }
        : { title: `Ciclo ${ctx.cycle_label ?? ''} reaberto`.replace(/\s+/g, ' ').trim(),
            body: `O ciclo de qualificação foi reaberto e você pode concluir sua avaliação até ${fmtDate(ctx.end_date)}.`, link };
    case 'roteiro_enviado':
      // resubmission = reenvio após reanálise/devolução — descrição própria para o
      // auditor distinguir do primeiro envio (feedback do cliente, 2026-09-11).
      return ctx.resubmission
        ? { title: 'Reanálise respondida — roteiro reenviado',
            body: `${ctx.provider_name ?? 'Um prestador'} reenviou o roteiro de qualificação após a reanálise solicitada.`, link }
        : { title: 'Roteiro enviado para análise',
            body: `${ctx.provider_name ?? 'Um prestador'} enviou o roteiro de qualificação para análise.`, link };
    case 'reanalise_solicitada': {
      const prazoRe = ctx.end_date ? ` O prazo para reenvio termina em ${fmtDate(ctx.end_date)}.` : '';
      // Variante em lote (spec 2026-09-11): o auditor devolve todos os critérios de
      // uma vez e o prestador recebe UMA notificação com a lista.
      if (Array.isArray(ctx.items) && ctx.items.length) {
        const MAX = 15;
        const trunc = (s: string) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);
        const lines = ctx.items.slice(0, MAX).map((it: any) => `${it.code} — ${trunc(String(it.text ?? ''))}`);
        const resto = ctx.items.length - MAX;
        const plural = ctx.items.length === 1 ? 'critério' : 'critérios';
        return {
          title: `Reanálise solicitada — ${ctx.items.length} ${plural}`,
          body: `O auditor devolveu ${ctx.items.length} ${plural} da sua avaliação para reanálise: ${lines.join('; ')}${resto > 0 ? `; … e mais ${resto} critério(s)` : ''}. Ajuste as evidências e reenvie.${prazoRe}`,
          link,
        };
      }
      return ctx.integral
        ? { title: 'Avaliação devolvida para reanálise',
            body: `O auditor devolveu sua avaliação. Revise os critérios apontados e reenvie.${prazoRe}`, link }
        : { title: `Reanálise solicitada — critério ${ctx.question_code ?? ''}`.trim(),
            body: `O auditor solicitou reanálise de um critério da sua avaliação. Ajuste a evidência e reenvie.${prazoRe}`, link };
    }
    case 'parecer_aprovado':
      return { title: `Resultado da sua qualificação — Selo ${ctx.seal ?? ''}`.trim(),
               body: `Sua avaliação de qualificação foi concluída: Selo ${ctx.seal ?? ''}, com ${fmtPct(ctx.percentual ?? 0)} de atingimento. Confira o resultado no portal.`, link };
    case 'parecer_reprovado':
      return { title: 'Avaliação concluída — não qualificado',
               body: 'Sua avaliação foi concluída sem atingir os requisitos do selo. Veja o parecer e o plano de ação no portal.', link };
    case 'certificado_emitido':
      return { title: 'Certificado de qualificação emitido',
               body: `Seu certificado está disponível no portal. Validade: ${fmtDate(ctx.valid_until)}. Parabéns por esta conquista! Nos encontramos novamente no próximo ciclo de qualificação.`, link };
    case 'plano_gerado':
      if (ctx.audience === 'prestador')
        return { title: 'Seu Plano de Ação está disponível',
                 body: 'Sua qualificação ainda tem próximos passos. Um Plano de Ação está disponível no PRP com os pontos identificados a partir da sua avaliação. Acesse para conferir e dar continuidade às tratativas.', link };
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
      // Data fora do título (cliente, 2026-09-24: "não está de fácil visualização") —
      // vai no corpo e, no e-mail, no card "Encerramento do ciclo".
      if (ctx.marco === 'fim')
        return { title: 'Último dia para enviar o roteiro',
                 body: `Hoje (${fmtDate(ctx.end_date)}) é o último dia para enviar seu roteiro de qualificação. Após o encerramento do ciclo não será mais possível enviar.`, link };
      if (ctx.marco === '7')
        return { title: 'Roteiro pendente — faltam 7 dias',
                 body: `Faltam 7 dias para o encerramento do ciclo (${fmtDate(ctx.end_date)}) e você ainda não enviou seu roteiro de qualificação.`, link };
      return { title: 'Roteiro pendente de resposta',
               body: `Você ainda não enviou seu roteiro de qualificação. O ciclo encerra em ${fmtDate(ctx.end_date)}.`, link };
    case 'certificado_vencendo':
      return { title: 'Certificado próximo do vencimento',
               body: `Seu Certificado de Qualificação é válido até ${fmtDate(ctx.valid_until)}. O próximo ciclo está chegando! Aproveite para revisar e manter suas documentações e evidências atualizadas.`, link };
    case 'ciclo_encerrado_sem_avaliacao':
      // Textos do cliente (2026-09-24).
      return { title: `Ciclo encerrado - Avaliação não concluída${ctx.cycle_label ? ` (${ctx.cycle_label})` : ''}`,
               body: 'O ciclo de qualificação da Rede de Prestadores foi encerrado e identificamos que sua avaliação não foi concluída dentro do prazo estabelecido. Por esse motivo, a avaliação deste ciclo permanecerá registrada como não concluída.', link };
    default:
      return { title: String(type), body: '', link };
  }
}
