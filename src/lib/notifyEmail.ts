// Modelos de e-mail HTML das notificações (5.4.7), no padrão visual do e-mail
// de credenciamento da Unimed Criciúma: cabeçalho verde-escuro com logo, faixa
// de status, corpo com cards/callouts, contato em destaque laranja e rodapé.
// Puro: sem DB/env — o server passa appUrl e o nome do destinatário.
// E-mail-safe: tabelas + estilos inline (sem CSS externo, sem flexbox).

import { type NotifyType, fmtDate } from './notifyCatalog.js';

const C = {
  darkGreen: '#00483A',   // cabeçalho/rodapé
  green: '#00995D',       // faixa de status, botões, bordas
  lightGreen: '#EAF6F0',  // cards
  orange: '#F47920',      // callout de contato
  lightOrange: '#FDF0E3',
  text: '#374151',
  muted: '#9CA3AF',
};

export const CONTACT_EMAIL = 'rededeprestadores@criciuma.unimedsc.com.br';

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
      ${highlight}
      ${steps}
      ${cta}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0;">
        <tr>
          <td width="4" style="background:${C.orange};border-radius:2px;"></td>
          <td style="background:${C.lightOrange};padding:14px 16px;${FONT}font-size:14px;line-height:1.6;color:${C.text};">
            <strong>Dúvidas?</strong> Entre em contato pelo e-mail:<br>
            <a href="mailto:${CONTACT_EMAIL}" style="color:${C.orange};font-weight:bold;text-decoration:none;">${CONTACT_EMAIL}</a>
          </td>
        </tr>
      </table>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;">
      <p style="margin:0;${FONT}font-size:14px;color:${C.green};font-weight:bold;">Atenciosamente,</p>
      <p style="margin:2px 0 0;${FONT}font-size:16px;font-weight:bold;color:#111827;">Rede de Prestadores</p>
      <p style="margin:2px 0 0;${FONT}font-size:12px;color:${C.muted};">Unimed Criciúma — Programa de Qualificação da Rede</p>
    </td>
  </tr>
  <tr>
    <td style="background:${C.darkGreen};padding:18px 28px;${FONT}text-align:center;">
      <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px;"><tr>
        <td style="background:#ffffff;border-radius:8px;padding:4px 8px;">
          <img src="${escapeHtml(appUrl)}/logo-unimed-criciuma.png" alt="Unimed Criciúma" height="26" style="display:block;height:26px;width:auto;">
        </td>
      </tr></table>
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

export function renderNotificationEmail(
  type: NotifyType,
  ctx: Record<string, any>,
  appUrl: string,
  recipientName?: string,
): { subject: string; html: string } {
  const cta = { label: 'Acessar o portal', url: `${appUrl}/qualificacao` };
  let b: EmailBlocks;

  switch (type) {
    case 'ciclo_aberto':
      b = {
        banner: `Ciclo de qualificação ${ctx.cycle_label ?? ''} aberto`.replace(/\s+/g, ' ').trim(),
        paragraphs: [
          `O ciclo de qualificação **${ctx.cycle_label ?? ''}** da Rede de Prestadores da Unimed Criciúma foi aberto e o seu roteiro já está disponível para preenchimento no portal.`,
        ],
        steps: 'acesse o portal, responda aos critérios do roteiro anexando as evidências solicitadas e, ao concluir, envie a avaliação para análise.',
        cta,
      };
      break;
    case 'roteiro_enviado':
      b = {
        banner: 'Roteiro enviado para análise',
        paragraphs: [`**${ctx.provider_name ?? 'Um prestador'}** enviou o roteiro de qualificação para análise.`],
        steps: 'acesse o painel do ciclo para analisar os critérios e as evidências enviadas.',
        cta,
      };
      break;
    case 'reanalise_solicitada':
      b = ctx.integral
        ? {
            banner: 'Avaliação devolvida para reanálise',
            paragraphs: ['O auditor devolveu a sua avaliação de qualificação para reanálise.'],
            steps: 'acesse o roteiro no portal, revise os critérios apontados, ajuste as evidências e reenvie a avaliação para análise.',
            cta,
          }
        : {
            banner: 'Reanálise de critério solicitada',
            paragraphs: ['O auditor solicitou a reanálise de um critério da sua avaliação de qualificação.'],
            steps: 'acesse o roteiro, leia a orientação do auditor no critério apontado, anexe a nova evidência e reenvie para análise.',
            cta,
          };
      break;
    case 'parecer_aprovado':
      b = {
        banner: 'Avaliação de qualificação aprovada',
        paragraphs: ['Sua avaliação de qualificação foi concluída pelo auditor com **aprovação**. Parabéns!'],
        highlight: { label: 'Classificação', value: `Selo ${ctx.seal ?? ''} — ${Math.round(Number(ctx.percentual ?? 0))}% de atingimento`, icon: '🏅', iconImg: sealImageUrl(ctx.seal, appUrl) },
        steps: 'acesse o portal para consultar o parecer completo e o seu certificado de qualificação.',
        cta,
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
        paragraphs: ['Seu **Certificado de Qualificação** da Rede de Prestadores foi emitido e já está disponível no portal.'],
        highlight: { label: 'Validade', value: fmtDate(ctx.valid_until) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'acesse o portal para visualizar, imprimir e compartilhar o certificado. A autenticidade pode ser verificada pelo QR code.',
        cta,
      };
      break;
    case 'plano_gerado':
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
        : {
            banner: 'Roteiro de qualificação pendente',
            paragraphs: ['Você ainda não enviou o seu roteiro de qualificação e o prazo termina junto com o encerramento do ciclo.'],
            highlight: { label: 'Encerramento do ciclo', value: fmtDate(ctx.end_date) || '—', iconImg: `${appUrl}/calendario.png` },
            steps: 'acesse o portal, conclua o preenchimento do roteiro com as evidências e envie para análise antes do encerramento.',
            cta,
          };
      break;
    case 'certificado_vencendo':
      b = {
        banner: 'Certificado próximo do vencimento',
        paragraphs: ['O seu Certificado de Qualificação da Rede de Prestadores está próximo do vencimento.'],
        highlight: { label: 'Válido até', value: fmtDate(ctx.valid_until) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'fique atento à abertura do próximo ciclo de qualificação para renovar o seu certificado.',
        cta,
      };
      break;
    default:
      b = { banner: String(type), paragraphs: [''], cta };
  }

  b.recipientName = recipientName;
  return { subject: `Portal Unimed — ${b.banner}`, html: renderEmailHtml(b, appUrl) };
}
