import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export type TokenKind = 'invite' | 'reset';

const EXPIRATION_MS: Record<TokenKind, number> = {
  invite: 24 * 60 * 60 * 1000, // 24h
  reset: 30 * 60 * 1000,       // 30min
};

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function hashToken(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyToken(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function expirationFor(kind: TokenKind, now: Date = new Date()): Date {
  return new Date(now.getTime() + EXPIRATION_MS[kind]);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() < now.getTime();
}
