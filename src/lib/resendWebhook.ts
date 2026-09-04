import crypto from 'node:crypto';

// Verifica a assinatura Svix dos webhooks do Resend (headers svix-id/-timestamp/-signature).
// Esquema: base = `${id}.${timestamp}.${rawBody}`; assinatura = base64(HMAC-SHA256(segredo, base)),
// onde o segredo é o "whsec_<base64>" decodificado. O header traz "v1,<sig> v1,<sig2>…".
// Rejeita timestamps fora de ±5 min (anti-replay). Comparação timing-safe.
export function verifyResendWebhook(
  secret: string,
  headers: { id?: string | null; timestamp?: string | null; signature?: string | null },
  rawBody: string,
  nowMs: number = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  const expBuf = Buffer.from(expected);

  return signature.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  });
}

export type WebhookStatus = 'entregue' | 'rejeitado' | 'reclamado' | 'aberto' | 'atrasado' | 'falhou' | 'suprimido';

// Mapeia o tipo de evento do Resend para o status de e-mail interno. null = ignorar
// (sent = já é 'enviado'; received/clicked não viram status próprio aqui).
// 'suprimido' aqui = supressão do PROVEDOR (email.suppressed); a supressão da nossa
// allowlist é gravada como 'ignorado' no momento do envio.
export function resendEventToStatus(type: string | undefined): WebhookStatus | null {
  switch (type) {
    case 'email.delivered': return 'entregue';
    case 'email.opened': return 'aberto';
    case 'email.bounced': return 'rejeitado';
    case 'email.complained': return 'reclamado';
    case 'email.failed': return 'falhou';
    case 'email.delivery_delayed': return 'atrasado';
    case 'email.suppressed': return 'suprimido';
    default: return null;
  }
}

// Condição SQL de precedência: quais status atuais podem ser SOBRESCRITOS pelo novo.
// Falhas (rejeitado/reclamado/falhou) são grudentas e vencem; o caminho feliz avança
// enviado → entregue → aberto sem regredir; atrasado só no começo. Sempre evita repetir.
export function webhookOverwriteCondition(status: WebhookStatus): string {
  const FAIL = "'rejeitado','reclamado','falhou','suprimido'";
  switch (status) {
    case 'rejeitado':
    case 'reclamado':
    case 'falhou':
    case 'suprimido': return `email_status NOT IN (${FAIL})`;
    case 'aberto':    return `email_status NOT IN (${FAIL},'aberto')`;
    case 'entregue':  return `email_status NOT IN (${FAIL},'aberto','entregue')`;
    case 'atrasado':  return `email_status IN ('pendente','enviado')`;
  }
}
