import { Resend } from 'resend';

export interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;
}

const SUBJECT = (code: string) => `Seu código de acesso ao Portal Unimed: ${code}`;
const BODY = (code: string) =>
  `Seu código de acesso é ${code}.\n\n` +
  `Ele vale por 10 minutos e só pode ser usado uma vez.\n` +
  `Se você não tentou entrar no Portal Unimed, ignore este e-mail.`;

/** Em dev: imprime o código (não envia e-mail real). Logger injetável para testes. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async sendOtp(to: string, code: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${SUBJECT(code)}`);
  }
}

/** Em produção: envia via Resend (sem links clicáveis, só o código). */
export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) {
    this.client = new Resend(apiKey);
  }
  async sendOtp(to: string, code: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: SUBJECT(code),
      text: BODY(code),
    });
    if (error) {
      throw new Error(`Falha ao enviar e-mail de OTP: ${error.message ?? error}`);
    }
  }
}

/**
 * Escolhe o mailer pelo ambiente:
 *  - RESEND_API_KEY + MAIL_FROM presentes → ResendMailer
 *  - produção sem a chave → erro de boot (falha barulhenta)
 *  - dev sem a chave → ConsoleMailer
 */
export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (apiKey && from) {
    return new ResendMailer(apiKey, from);
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: RESEND_API_KEY/MAIL_FROM ausentes em produção. Abortando boot.');
    process.exit(1);
  }
  console.warn('[mailer] RESEND_API_KEY ausente — usando ConsoleMailer (apenas dev).');
  return new ConsoleMailer();
}
