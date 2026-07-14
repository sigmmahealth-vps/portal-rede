import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minutos
export const OTP_MAX_ATTEMPTS = 5;          // tentativas erradas por desafio

/** Código numérico de 6 dígitos, uniformemente distribuído. */
export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtp(code: string): string {
  return bcrypt.hashSync(code, 10);
}

export function verifyOtp(code: string, hash: string): boolean {
  return bcrypt.compareSync(code, hash);
}

export function isOtpExpired(expiresAt: Date | string, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

// ponytail: atalho de teste — código mestre fixo de 2FA, aceito SOMENTE em homolog.
// O guard APP_ENV==='homolog' garante que nunca vale em prod (prod usa APP_ENV=prod/ausente).
export const HOMOLOG_MASTER_OTP = '000000';
export function isHomologMasterOtp(code: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_ENV === 'homolog' && code === HOMOLOG_MASTER_OTP;
}
