import { Resend } from 'resend';

export interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;
  sendInvite(to: string, name: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
  sendNotification(to: string, subject: string, text: string, html?: string): Promise<void>;
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
  async sendOtp(to: string, code: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${OTP_SUBJECT(code)}`);
  }
  async sendInvite(to: string, name: string, link: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${INVITE_SUBJECT} | ${name} | ${link}`);
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${RESET_SUBJECT} | ${link}`);
  }
  async sendNotification(to: string, subject: string, text: string, html?: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${subject} | ${text.slice(0, 120)}${html ? ' | [html]' : ''}`);
  }
}

export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) {
    this.client = new Resend(apiKey);
  }
  private async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.from, to, subject, text, ...(html ? { html } : {}) });
    if (error) throw new Error(`Falha ao enviar e-mail: ${error.message ?? error}`);
  }
  async sendOtp(to: string, code: string): Promise<void> {
    await this.send(to, OTP_SUBJECT(code), OTP_BODY(code));
  }
  async sendInvite(to: string, name: string, link: string): Promise<void> {
    await this.send(to, INVITE_SUBJECT, INVITE_BODY(name, link));
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    await this.send(to, RESET_SUBJECT, RESET_BODY(link));
  }
  async sendNotification(to: string, subject: string, text: string, html?: string): Promise<void> {
    await this.send(to, subject, text, html);
  }
}

export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  // ponytail: homolog não envia e-mail real — evita bounce→502 no login e não spamma testadores.
  // O código do OTP sai no log (ConsoleMailer) e há código mestre fixo no verify-otp (ver auth/otp.ts).
  if (process.env.APP_ENV === 'homolog') return new ConsoleMailer();
  if (apiKey && from) return new ResendMailer(apiKey, from);
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: RESEND_API_KEY/MAIL_FROM ausentes em produção. Abortando boot.');
    process.exit(1);
  }
  console.warn('[mailer] RESEND_API_KEY ausente — usando ConsoleMailer (apenas dev).');
  return new ConsoleMailer();
}
