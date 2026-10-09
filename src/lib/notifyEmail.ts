// Modelos de e-mail HTML das notificações (5.4.7), no padrão visual do e-mail
// de credenciamento da Unimed Criciúma: cabeçalho verde-escuro com logo, faixa
// de status, corpo com cards/callouts, contato em destaque laranja e rodapé.
// Puro: sem DB/env — o server passa appUrl e o nome do destinatário.
// E-mail-safe: tabelas + estilos inline (sem CSS externo, sem flexbox).

import { type NotifyType, fmtDate, notifyLink, MANUAL_TXT } from './notifyCatalog.js';
import { fmtPct } from './formatDate.js';

const C = {
  darkGreen: '#00483A',   // cabeçalho/rodapé
  green: '#00995D',       // faixa de status, botões, bordas
  lightGreen: '#EAF6F0',  // cards
  orange: '#F47920',      // callout de contato
  lightOrange: '#FDF0E3',
  text: '#374151',
  muted: '#9CA3AF',
};

export const CONTACT_EMAIL = 'prp@criciuma.unimedsc.com.br';

// Unimed Sans via @font-face (clientes que suportam; os demais caem no Arial).
const FONT = "font-family:'Unimed Sans',Arial,Helvetica,sans-serif;";

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Texto simples com **negrito** → HTML escapado com <strong>.
function rich(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export interface EmailBlocks {
  banner: string;                                  // faixa verde (vira MAIÚSCULAS)
  recipientName?: string;                          // "Olá, Fulano."
  paragraphs: string[];                            // corpo; aceita **negrito**
  // card estilo "protocolo": icon = emoji no quadrado verde; iconImg = imagem
  // solta (ex.: medalha do selo), tem precedência sobre icon.
  highlight?: { label: string; value: string; icon?: string; iconImg?: string };
  // Card de resultado (aprovação): % grande + selo à esquerda, status/certificado/validade à direita.
  result?: { pct: string; seal: string; sealImg?: string; status: string; certificate?: string; validUntil?: string };
  steps?: string;                                  // callout "Próximos passos:"
  cta?: { label: string; url: string };            // botão verde
}

// Arte da medalha na cor do selo (aprovação): public/selos/{ouro,prata,bronze}.png.
export function sealImageUrl(seal: unknown, appUrl: string): string | undefined {
  const s = String(seal ?? '').toLowerCase();
  for (const slug of ['ouro', 'prata', 'bronze']) {
    if (s.includes(slug)) return `${appUrl}/selos/${slug}.png`;
  }
  return undefined;
}

export function renderEmailHtml(b: EmailBlocks, appUrl: string): string {
  const greeting = b.recipientName
    ? `Olá, <strong>${escapeHtml(b.recipientName)}</strong>.`
    : 'Olá.';
  const paragraphs = b.paragraphs
    .map(p => `<p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:${C.text};">${rich(p)}</p>`)
    .join('');
  const highlight = b.highlight ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;background:${C.lightGreen};border-radius:10px;">
      <tr>
        <td width="72" style="padding:14px 0 14px 16px;">
          ${b.highlight.iconImg
            ? `<img src="${escapeHtml(b.highlight.iconImg)}" alt="" width="52" style="display:block;width:52px;height:auto;">`
            : `<table cellpadding="0" cellspacing="0"><tr>
            <td width="44" height="44" align="center" style="background:${C.green};border-radius:10px;${FONT}font-size:20px;color:#ffffff;">${escapeHtml(b.highlight.icon ?? '✉️')}</td>
          </tr></table>`}
        </td>
        <td style="padding:18px;${FONT}">
          <div style="font-size:11px;letter-spacing:1px;color:${C.green};font-weight:bold;">${escapeHtml(b.highlight.label).toUpperCase()}</div>
          <div style="font-size:20px;font-weight:bold;color:#111827;margin-top:2px;">${escapeHtml(b.highlight.value)}</div>
        </td>
      </tr>
    </table>` : '';
  const lbl = (t: string) =>
    `<div style="${FONT}font-size:10px;letter-spacing:1px;color:${C.green};font-weight:bold;">${escapeHtml(t).toUpperCase()}</div>`;
  const side = (icon: string, label: string, value: string) => `
          <tr>
            <td width="30" style="padding:6px 10px 6px 0;vertical-align:middle;">
              <img src="${escapeHtml(appUrl)}/${icon}" alt="" width="22" height="22" style="display:block;width:22px;height:22px;">
            </td>
            <td style="padding:6px 0;vertical-align:middle;">
              ${lbl(label)}
              <div style="${FONT}font-size:14px;font-weight:bold;color:#111827;">${escapeHtml(value)}</div>
            </td>
          </tr>`;
  const r = b.result;
  const result = r ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;background:${C.lightGreen};border-radius:12px;">
      <tr>
        ${r.sealImg ? `<td width="76" style="padding:20px 0 20px 20px;vertical-align:middle;">
          <img src="${escapeHtml(r.sealImg)}" alt="Selo ${escapeHtml(r.seal)}" width="56" style="display:block;width:56px;height:auto;">
        </td>` : ''}
        <td style="padding:20px 16px;vertical-align:middle;">
          ${lbl('Resultado da qualificação')}
          <div style="${FONT}font-size:36px;line-height:1.1;font-weight:bold;color:#111827;margin-top:2px;">${escapeHtml(r.pct)}</div>
          <div style="${FONT}font-size:13px;color:${C.text};">de atingimento</div>
          <div style="border-top:1px solid #CFE7DA;margin:12px 0 10px;"></div>
          ${lbl('Classificação')}
          <div style="${FONT}font-size:17px;font-weight:bold;color:#111827;">Selo ${escapeHtml(r.seal)}</div>
        </td>
        <td width="1" style="background:#CFE7DA;"></td>
        <td width="200" style="padding:14px 20px;vertical-align:middle;">
          <table cellpadding="0" cellspacing="0">
            ${side('icone-status.png', 'Status', r.status)}
            ${r.certificate ? side('icone-certificado.png', 'Certificado', r.certificate) : ''}
            ${r.validUntil ? side('icone-validade.png', 'Validade', r.validUntil) : ''}
          </table>
        </td>
      </tr>
    </table>` : '';
  const steps = b.steps ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        <td width="4" style="background:${C.green};border-radius:2px;"></td>
        <td style="background:${C.lightGreen};padding:14px 16px;${FONT}font-size:14px;line-height:1.6;color:${C.text};">
          <strong>Próximos passos:</strong> ${rich(b.steps)}
        </td>
      </tr>
    </table>` : '';
  const cta = b.cta ? `
    <table cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
      <tr>
        <td align="center" style="background:${C.green};border-radius:8px;">
          <a href="${escapeHtml(b.cta.url)}" target="_blank"
             style="display:inline-block;padding:12px 28px;${FONT}font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">
            ${escapeHtml(b.cta.label)}
          </a>
        </td>
      </tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  @font-face { font-family: 'Unimed Sans'; src: url('${escapeHtml(appUrl)}/fonts/Unimed-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; }
  @font-face { font-family: 'Unimed Sans'; src: url('${escapeHtml(appUrl)}/fonts/Unimed-Bold.woff2') format('woff2'); font-weight: 700; font-style: normal; }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:16px 0;"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;">
  <tr>
    <td align="center" style="background:${C.darkGreen};padding:26px 28px;">
      <img src="${escapeHtml(appUrl)}/logo-prp-branco.png" alt="PRP — Portal da Rede de Prestadores" height="44" style="display:block;height:44px;width:auto;">
    </td>
  </tr>
  <tr>
    <td style="background:${C.green};padding:12px 28px;${FONT}font-size:13px;font-weight:bold;letter-spacing:1px;color:#ffffff;">
      &#10003;&nbsp;&nbsp;${escapeHtml(b.banner).toUpperCase()}
    </td>
  </tr>
  <tr>
    <td style="padding:28px;">
      <p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:#111827;"><strong>${greeting}</strong></p>
      ${paragraphs}
      ${result}
      ${highlight}
      ${steps}
      ${cta}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0;">
        <tr>
          <td width="4" style="background:${C.orange};border-radius:2px;"></td>
          <td width="56" style="background:${C.lightOrange};padding:14px 0 14px 16px;vertical-align:middle;">
            <img src="${escapeHtml(appUrl)}/suporte.png" alt="Suporte" width="40" height="40" style="display:block;width:40px;height:40px;">
          </td>
          <td style="background:${C.lightOrange};padding:14px 16px;${FONT}font-size:14px;line-height:1.6;color:${C.text};">
            <strong>Dúvidas?</strong> Entre em contato pelo e-mail:<br>
            <a href="mailto:${CONTACT_EMAIL}" style="color:${C.orange};font-weight:bold;text-decoration:none;">${CONTACT_EMAIL}</a>
          </td>
        </tr>
      </table>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;">
      <p style="margin:0;${FONT}font-size:14px;color:${C.green};font-weight:bold;">Atenciosamente,</p>
      <p style="margin:2px 0 0;${FONT}font-size:16px;font-weight:bold;color:#111827;">Rede de Prestadores</p>
    </td>
  </tr>
  <tr>
    <td style="background:${C.darkGreen};padding:22px 28px;${FONT}text-align:center;">
      <img src="${escapeHtml(appUrl)}/logo-unimed-email.png" alt="Unimed Criciúma" width="152" height="56" style="display:inline-block;width:152px;height:56px;margin-bottom:12px;">
      <div style="font-size:12px;color:#ffffff;"><strong style="color:#8FD3B6;">Unimed Criciúma</strong> · Cooperativa de Trabalho Médico</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px;">Este é um e-mail automático. Em caso de dúvidas, entre em contato com a equipe da Rede de Prestadores.</div>
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Conteúdo por tipo de notificação (os tipos só-portal também renderizam, para
// pré-visualização e uso futuro — o server simplesmente não os envia).
// ---------------------------------------------------------------------------

// Blocos por tipo (banner, corpo, destaque, próximos passos, CTA) — usados pelo
// e-mail e pela caixa de entrada do portal (que renderiza os mesmos blocos em React;
// com appUrl = '' as imagens saem relativas, prontas para a SPA).
export function notificationBlocks(
  type: NotifyType,
  ctx: Record<string, any>,
  appUrl: string,
): EmailBlocks {
  const cta = { label: 'Acessar o portal', url: `${appUrl}${notifyLink(type, ctx)}` };
  const concluirCta = { ...cta, label: 'Concluir roteiro' };   // lembretes ao prestador (cliente, 2026-09-24)
  const reanaliseCta = { ...cta, label: 'Preencher reanálise' }; // devolução p/ reanálise (cliente, 2026-09-24)
  let b: EmailBlocks;

  switch (type) {
    case 'ciclo_aberto':
      b = {
        banner: `Ciclo de qualificação ${ctx.cycle_label ?? ''} aberto`.replace(/\s+/g, ' ').trim(),
        paragraphs: [
          `O ciclo de qualificação **${ctx.cycle_label ?? ''}** da Rede de Prestadores da Unimed Criciúma foi aberto e o seu roteiro já está disponível para preenchimento no portal.`,
          ...(ctx.has_manual ? [MANUAL_TXT.trim()] : []),
        ],
        ...(ctx.end_date ? { highlight: { label: 'Prazo para envio', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` } } : {}),
        steps: 'acesse o portal, responda aos critérios do roteiro anexando as evidências solicitadas e, ao concluir, envie a avaliação para análise.',
        cta,
      };
      break;
    case 'ciclo_reaberto':
      b = {
        // Título pedido pelo cliente (2026-09-24): "Ciclo Prorrogado".
        banner: ctx.prorrogado
          ? 'Ciclo prorrogado'
          : `Ciclo ${ctx.cycle_label ?? ''} reaberto`.replace(/\s+/g, ' ').trim(),
        paragraphs: [
          ctx.prorrogado
            ? `O prazo do ciclo de qualificação **${ctx.cycle_label ?? ''}** da Rede de Prestadores da Unimed Criciúma foi prorrogado até **${fmtDate(ctx.end_date) || '—'}**. A sua avaliação voltou a ficar disponível no portal e pode ser enviada até essa data.`
            : `O ciclo de qualificação **${ctx.cycle_label ?? ''}** da Rede de Prestadores da Unimed Criciúma foi reaberto e a sua avaliação voltou a ficar disponível no portal.`,
        ],
        highlight: { label: 'Novo prazo para envio', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'acesse o portal, conclua o preenchimento do roteiro com as evidências e envie para análise antes do novo prazo.',
        cta,
      };
      break;
    case 'roteiro_enviado':
      // resubmission = reenvio após reanálise/devolução (feedback do cliente, 2026-09-11).
      b = ctx.resubmission
        ? {
            banner: 'Reanálise respondida — roteiro reenviado',
            paragraphs: [`**${ctx.provider_name ?? 'Um prestador'}** reenviou o roteiro de qualificação após a reanálise solicitada.`],
            steps: 'acesse o painel do ciclo para reanalisar os critérios devolvidos e as novas evidências.',
            cta,
          }
        : {
            banner: 'Roteiro enviado para análise',
            paragraphs: [`**${ctx.provider_name ?? 'Um prestador'}** enviou o roteiro de qualificação para análise.`],
            steps: 'acesse o painel do ciclo para analisar os critérios e as evidências enviadas.',
            cta,
          };
      break;
    case 'reanalise_solicitada':
      // Variante em lote (spec 2026-09-11): devolução única com a lista de critérios.
      if (Array.isArray(ctx.items) && ctx.items.length) {
        const MAX = 15;
        const trunc = (s: string) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);
        const plural = ctx.items.length === 1 ? 'critério' : 'critérios';
        b = {
          banner: `Reanálise solicitada — ${ctx.items.length} ${plural}`,
          paragraphs: [
            `O auditor devolveu **${ctx.items.length} ${plural}** da sua avaliação de qualificação para reanálise:`,
            ...ctx.items.slice(0, MAX).map((it: any) => `**${it.code}** — ${trunc(String(it.text ?? ''))}`),
            ...(ctx.items.length > MAX ? [`… e mais ${ctx.items.length - MAX} critério(s) — veja a lista completa no portal.`] : []),
          ],
          ...(ctx.end_date ? { highlight: { label: 'Prazo para reenvio', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` } } : {}),
          steps: 'acesse o roteiro, leia a orientação do auditor em cada critério apontado, anexe as novas evidências e reenvie para análise.',
          cta: reanaliseCta,
        };
        break;
      }
      b = ctx.integral
        ? {
            banner: 'Avaliação devolvida para reanálise',
            paragraphs: ['O auditor devolveu a sua avaliação de qualificação para reanálise.'],
            ...(ctx.end_date ? { highlight: { label: 'Prazo para reenvio', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` } } : {}),
            steps: 'acesse o roteiro no portal, revise os critérios apontados, ajuste as evidências e reenvie a avaliação para análise.',
            cta: reanaliseCta,
          }
        : {
            banner: 'Reanálise de critério solicitada',
            paragraphs: ['O auditor solicitou a reanálise de um critério da sua avaliação de qualificação.'],
            ...(ctx.end_date ? { highlight: { label: 'Prazo para reenvio', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` } } : {}),
            steps: 'acesse o roteiro, leia a orientação do auditor no critério apontado, anexe a nova evidência e reenvie para análise.',
            cta: reanaliseCta,
          };
      break;
    case 'parecer_aprovado':
      b = {
        // Textos e card de resultado pedidos pelo cliente (2026-09-24).
        banner: 'Resultado da sua qualificação',
        paragraphs: ['Sua avaliação de qualificação foi concluída. Confira abaixo o resultado da sua avaliação.'],
        result: {
          pct: fmtPct(ctx.percentual ?? 0),
          seal: String(ctx.seal ?? ''),
          sealImg: sealImageUrl(ctx.seal, appUrl),
          status: 'Aprovado',
          certificate: ctx.has_certificate ? 'Disponível no portal' : undefined,
          validUntil: ctx.valid_until ? fmtDate(ctx.valid_until) : undefined,
        },
        steps: 'acesse o portal para consultar o parecer completo e o seu certificado de qualificação.',
        cta: { ...cta, label: 'Acessar meu resultado' },
      };
      break;
    case 'parecer_reprovado':
      b = {
        banner: 'Avaliação concluída — não qualificado',
        paragraphs: ['Sua avaliação de qualificação foi concluída sem atingir os requisitos para o selo nesta rodada.'],
        steps: 'acesse o portal para consultar o parecer e o plano de ação com as adequações necessárias. Sua evolução será acompanhada pela equipe de qualificação.',
        cta,
      };
      break;
    case 'certificado_emitido':
      b = {
        banner: 'Certificado de qualificação emitido',
        // Texto e botão do cliente (2026-09-24): chamada para o próximo ciclo.
        paragraphs: [
          'Seu **Certificado de Qualificação** da Rede de Prestadores foi emitido e já está disponível no portal.',
          'Parabéns por esta conquista! Nos encontramos novamente no próximo ciclo de qualificação.',
        ],
        highlight: { label: 'Validade', value: fmtDate(ctx.valid_until) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'acesse o portal para visualizar, imprimir e compartilhar o certificado. A autenticidade pode ser verificada pelo QR code.',
        cta: { ...cta, label: 'Acessar certificado' },
      };
      break;
    case 'plano_gerado':
      // Versão do prestador com texto/botão do cliente (2026-09-24); auditoria segue a genérica.
      if (ctx.audience === 'prestador') {
        b = {
          banner: 'Seu Plano de Ação está disponível',
          paragraphs: [
            'Sua qualificação ainda tem próximos passos. Um **Plano de Ação** está disponível no PRP com os pontos identificados a partir da sua avaliação.',
            'Acesse para conferir e dar continuidade às tratativas.',
          ],
          steps: 'acesse o portal para consultar as ações, os prazos e registrar as evidências de conclusão.',
          cta: { ...cta, label: 'Acessar Plano de Ação' },
        };
        break;
      }
      b = {
        banner: 'Plano de ação gerado',
        paragraphs: [
          `Um plano de ação foi gerado${ctx.provider_name ? ` para **${ctx.provider_name}**` : ''} a partir da avaliação de qualificação.`,
        ],
        steps: 'acesse o portal para consultar as ações, os prazos e registrar as evidências de conclusão.',
        cta,
      };
      break;
    case 'acao_aguardando_validacao':
      b = {
        banner: 'Ação concluída aguardando validação',
        paragraphs: [`**${ctx.provider_name ?? 'O prestador'}** concluiu a ação "${ctx.what ?? ''}" do plano de ação e aguarda a validação do auditor.`],
        steps: 'acesse o plano de ação no portal para validar ou devolver a ação.',
        cta,
      };
      break;
    case 'acao_vencendo':
      b = {
        banner: 'Ação do plano próxima do vencimento',
        paragraphs: [`A ação **"${ctx.what ?? ''}"** do seu plano de ação está próxima do vencimento.`],
        highlight: { label: 'Vencimento', value: fmtDate(ctx.due_date) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'acesse o portal, registre as evidências de conclusão e marque a ação como concluída antes do prazo.',
        cta,
      };
      break;
    case 'acao_atrasada':
      b = {
        banner: 'Ação do plano em atraso',
        paragraphs: [`A ação **"${ctx.what ?? ''}"**${ctx.provider_name ? ` do plano de **${ctx.provider_name}**` : ' do seu plano de ação'} venceu e não foi concluída.`],
        highlight: { label: 'Venceu em', value: fmtDate(ctx.due_date) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'acesse o portal e regularize a ação o quanto antes registrando as evidências de conclusão.',
        cta,
      };
      break;
    case 'roteiro_pendente':
      b = ctx.digest
        ? {
            banner: `Roteiros pendentes — ciclo ${ctx.cycle_label ?? ''}`.replace(/\s+/g, ' ').trim(),
            paragraphs: ['Há prestadores que ainda não enviaram o roteiro de qualificação e o ciclo está próximo do encerramento.'],
            highlight: { label: 'Roteiros pendentes', value: `${ctx.count ?? 0} — ciclo encerra em ${fmtDate(ctx.end_date)}`, iconImg: `${appUrl}/calendario.png` },
            steps: 'acesse o painel do ciclo para acompanhar os pendentes e orientar os prestadores.',
            cta,
          }
        : ctx.marco === 'fim'
        ? {
            banner: 'Último dia para enviar o roteiro',
            paragraphs: ['Hoje é o último dia do ciclo de qualificação e você ainda não enviou o seu roteiro. Após o encerramento não será mais possível enviar.'],
            highlight: { label: 'Encerramento do ciclo', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` },
            steps: 'acesse o portal agora, conclua o roteiro com as evidências e envie para análise antes do encerramento de hoje.',
            cta: concluirCta,
          }
        : ctx.marco === '7'
        ? {
            banner: 'Faltam 7 dias para enviar o roteiro',
            paragraphs: ['Faltam 7 dias para o encerramento do ciclo de qualificação e você ainda não enviou o seu roteiro.'],
            highlight: { label: 'Encerramento do ciclo', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` },
            steps: 'acesse o portal e envie o roteiro com as evidências antes do encerramento.',
            cta: concluirCta,
          }
        : {
            banner: 'Roteiro pendente de resposta',
            paragraphs: ['Você ainda não enviou o seu roteiro de qualificação e o prazo termina junto com o encerramento do ciclo.'],
            highlight: { label: 'Encerramento do ciclo', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` },
            steps: 'acesse o portal, conclua o preenchimento do roteiro com as evidências e envie para análise antes do encerramento.',
            cta: concluirCta,
          };
      break;
    case 'certificado_vencendo':
      b = {
        banner: 'Certificado próximo do vencimento',
        // Texto do cliente (2026-09-24): chamada para o próximo ciclo + separação de documentos.
        paragraphs: [
          `Seu **Certificado de Qualificação** é válido até **${fmtDate(ctx.valid_until) || '—'}**. O próximo ciclo está chegando!`,
          'Aproveite para revisar e manter suas documentações e evidências atualizadas. Assim você estará preparado para a próxima avaliação e para alcançar a melhor pontuação possível.',
        ],
        highlight: { label: 'Válido até', value: fmtDate(ctx.valid_until) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'fique atento à abertura do próximo ciclo de qualificação para renovar o seu certificado.',
        cta,
      };
      break;
    case 'ciclo_encerrado_sem_avaliacao':
      b = {
        // Textos do cliente (2026-09-24).
        banner: 'Ciclo encerrado - Avaliação não concluída',
        paragraphs: ['O ciclo de qualificação da Rede de Prestadores foi encerrado e identificamos que sua avaliação não foi concluída dentro do prazo estabelecido. Por esse motivo, a avaliação deste ciclo permanecerá registrada como não concluída.'],
        highlight: { label: 'Ciclo encerrado', value: ctx.cycle_label ?? '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'não será possível concluir ou retomar esta avaliação após o encerramento do ciclo. A não conclusão ficará registrada no histórico de qualificação do prestador e poderá resultar na aplicação de penalidades nos próximos ciclos, conforme as regras do Programa de Qualificação da Rede.',
        cta,
      };
      break;
    case 'senha_solicitada':
      b = {
        banner: 'Redefinição de senha solicitada',
        paragraphs: [`**${ctx.provider_name ?? 'Um prestador'}** pediu a redefinição da senha de acesso ao portal${ctx.unit_label ? ` da unidade **${ctx.unit_label}**` : ''}.`],
        steps: 'confirme a identidade de quem pediu pelo contato do cadastro e defina uma nova senha provisória para essa unidade na aba Acessos do prestador.',
        cta: { ...cta, label: 'Abrir o cadastro' },
      };
      break;
    default:
      b = { banner: String(type), paragraphs: [''], cta };
  }
  return b;
}

export function renderNotificationEmail(
  type: NotifyType,
  ctx: Record<string, any>,
  appUrl: string,
  recipientName?: string,
): { subject: string; html: string } {
  const b = notificationBlocks(type, ctx, appUrl);
  b.recipientName = recipientName;
  return { subject: `Portal Unimed — ${b.banner}`, html: renderEmailHtml(b, appUrl) };
}
