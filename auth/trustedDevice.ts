import crypto from 'crypto';

export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

/** Segredo opaco guardado no cookie do navegador (nunca persistido em texto puro). */
export function generateDeviceSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** sha256 — o segredo já tem alta entropia, não precisa de bcrypt. */
export function hashDeviceSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Comparação em tempo constante para evitar timing attacks. */
export function verifyDeviceSecret(secret: string, hash: string): boolean {
  const a = Buffer.from(hashDeviceSecret(secret), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Rótulo amigável para a tela de dispositivos (ex.: "Chrome em Windows"). */
export function deviceLabelFromUserAgent(ua: string | undefined): string {
  if (!ua) return 'Dispositivo desconhecido';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Macintosh|Mac OS/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' : 'SO desconhecido';
  return `${browser} em ${os}`;
}

export function isTrustedDeviceValid(
  d: { expiresAt: Date | string; revokedAt: Date | string | null },
  now: Date,
): boolean {
  if (d.revokedAt) return false;
  return new Date(d.expiresAt).getTime() > now.getTime();
}
