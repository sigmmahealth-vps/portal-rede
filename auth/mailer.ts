import { Resend } from 'resend';
import { renderEmailHtml } from '../src/lib/notifyEmail.js';

// HTML no padrão visual Unimed (mesmo shell das notificações 5.4.7). O texto puro
// permanece como fallback. appUrl só alimenta o logo do cabeçalho.
const appUrl = () => process.env.APP_URL ?? '';

export const otpEmailHtml = (code: string) => renderEmailHtml({
  banner: 'Código de acesso ao portal',
  paragraphs: [
    'Use o código abaixo para concluir o seu acesso ao Portal da Rede de Prestadores.',
    'Ele vale por **10 minutos** e só pode ser usado uma vez.',
    'Se você não tentou entrar no portal, ignore este e-mail.',
  ],
  highlight: { label: 'Seu código de acesso', value: code, iconImg: `${appUrl()}/codigo.png` },
}, appUrl());

export const inviteEmailHtml = (name: string, link: string) => renderEmailHtml({
  banner: 'Bem-vindo ao Portal da Rede de Prestadores',
  recipientName: name,
  paragraphs: [
    'Sua conta foi criada no **Portal da Rede de Prestadores da Unimed Criciúma**. Para começar, defina a sua senha de acesso.',
    'O link vale por **24 horas** e só pode ser usado uma vez. Se você não esperava este convite, ignore este e-mail.',
  ],
  cta: { label: 'Definir minha senha', url: link },
}, appUrl());

export const resetEmailHtml = (link: string) => renderEmailHtml({
  banner: 'Redefinição de senha',
  paragraphs: [
    'Recebemos uma solicitação para redefinir a sua senha no Portal da Rede de Prestadores.',
    'O link vale por **30 minutos** e só pode ser usado uma vez. Se você não solicitou, ignore este e-mail e sua senha continuará a mesma.',
  ],
  cta: { label: 'Redefinir senha', url: link },
}, appUrl());

// Desfecho de um envio de notificação: 'sent' = entregue ao provedor (Resend) sem
// erro; 'suppressed' = não saiu de verdade (fora da EMAIL_ALLOWLIST ou ConsoleMailer).
export type EmailSendResult = 'sent' | 'suppressed';

export interface Mailer {
  sendOtp(to: string, code: string): Promise<EmailSendResult>;
  sendInvite(to: string, name: string, link: string): Promise<EmailSendResult>;
  sendPasswordReset(to: string, link: string): Promise<EmailSendResult>;
  sendNotification(to: string, subject: string, text: string, html?: string): Promise<EmailSendResult>;
}

const OTP_SUBJECT = (code: string) => `Seu código de acesso ao Portal Unimed: ${code}`;
const OTP_BODY = (code: string) =>
  `Seu código de acesso é ${code}.\n\n` +
  `Ele vale por 10 minutos e só pode ser usado uma vez.\n` +
  `Se você não tentou entrar no Portal Unimed, ignore este e-mail.`;

const INVITE_SUBJECT = 'Bem-vindo ao Portal Unimed Criciúma';
const INVITE_BODY = (name: string, link: string) =>
  `Olá, ${name}!\n\n` +
  `Sua conta foi criada no Portal Unimed Criciúma. Para começar, defina sua senha:\n\n` +
  `${link}\n\n` +
  `Este link vale por 24 horas e só pode ser usado uma vez.\n` +
  `Se você não esperava este convite, ignore este e-mail.`;

const RESET_SUBJECT = 'Redefinição de senha — Portal Unimed';
const RESET_BODY = (link: string) =>
  `Recebemos uma solicitação para redefinir sua senha. Clique no link abaixo:\n\n` +
  `${link}\n\n` +
  `Este link vale por 30 minutos e só pode ser usado uma vez.\n` +
  `Se você não solicitou, ignore este e-mail e sua senha continuará a mesma.`;

export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async sendOtp(to: string, code: string): Promise<EmailSendResult> {
    this.log(`[ConsoleMailer] Para: ${to} | ${OTP_SUBJECT(code)}`);
    return 'suppressed';
  }
  async sendInvite(to: string, name: string, link: string): Promise<EmailSendResult> {
    this.log(`[ConsoleMailer] Para: ${to} | ${INVITE_SUBJECT} | ${name} | ${link}`);
    return 'suppressed';
  }
  async sendPasswordReset(to: string, link: string): Promise<EmailSendResult> {
    this.log(`[ConsoleMailer] Para: ${to} | ${RESET_SUBJECT} | ${link}`);
    return 'suppressed';
  }
  async sendNotification(to: string, subject: string, text: string, html?: string): Promise<EmailSendResult> {
    this.log(`[ConsoleMailer] Para: ${to} | ${subject} | ${text.slice(0, 120)}${html ? ' | [html]' : ''}`);
    return 'suppressed'; // dev/homolog: nada é enviado de verdade
  }
}

// Allowlist de teste: com a lista não vazia, só destinatários cujo endereço
// TERMINA com alguma entrada recebem e-mail real — o resto é suprimido e logado.
// Ex.: "homolog@hotmail.com" pega adm-homolog@/prestador-homolog@/...;
// "@sigmma.health" pega o domínio todo; um e-mail completo pega só ele.
// Garante que nenhum prestador recebe e-mail na fase de testes.
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function emailAllowed(to: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const t = to.trim().toLowerCase();
  return allowlist.some((e) => t.endsWith(e));
}

export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string, private readonly allowlist: string[] = []) {
    this.client = new Resend(apiKey);
  }
  private async send(to: string, subject: string, text: string, html?: string): Promise<EmailSendResult> {
    if (!emailAllowed(to, this.allowlist)) {
      console.log(`[mailer] SUPRIMIDO (fora da EMAIL_ALLOWLIST): ${to} | ${subject}`);
      return 'suppressed';
    }
    const { error } = await this.client.emails.send({ from: this.from, to, subject, text, ...(html ? { html } : {}) });
    if (error) throw new Error(`Falha ao enviar e-mail: ${error.message ?? error}`);
    return 'sent';
  }
  async sendOtp(to: string, code: string): Promise<EmailSendResult> {
    return this.send(to, OTP_SUBJECT(code), OTP_BODY(code), otpEmailHtml(code));
  }
  async sendInvite(to: string, name: string, link: string): Promise<EmailSendResult> {
    return this.send(to, INVITE_SUBJECT, INVITE_BODY(name, link), inviteEmailHtml(name, link));
  }
  async sendPasswordReset(to: string, link: string): Promise<EmailSendResult> {
    return this.send(to, RESET_SUBJECT, RESET_BODY(link), resetEmailHtml(link));
  }
  async sendNotification(to: string, subject: string, text: string, html?: string): Promise<EmailSendResult> {
    return this.send(to, subject, text, html);
  }
}

export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const allowlist = parseAllowlist(process.env.EMAIL_ALLOWLIST);
  // Homolog só envia e-mail real com EMAIL_ALLOWLIST definida (e apenas para
  // quem está nela) — sem a lista, mantém o ConsoleMailer de sempre. Evita
  // qualquer disparo a prestador real na fase de testes; OTP tem código mestre
  // no verify-otp (ver auth/otp.ts).
  if (process.env.APP_ENV === 'homolog' && allowlist.length === 0) return new ConsoleMailer();
  if (apiKey && from) {
    if (allowlist.length > 0) console.log(`[mailer] EMAIL_ALLOWLIST ativa (${allowlist.length} entrada(s)) — demais destinatários serão suprimidos.`);
    return new ResendMailer(apiKey, from, allowlist);
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: RESEND_API_KEY/MAIL_FROM ausentes em produção. Abortando boot.');
    process.exit(1);
  }
  console.warn('[mailer] RESEND_API_KEY ausente — usando ConsoleMailer (apenas dev).');
  return new ConsoleMailer();
}
