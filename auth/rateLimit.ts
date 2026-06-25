import { query } from '../db/db.js';

export const PASSWORD_MAX_FAILURES = 5;
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;  // 15 minutos

/** Quantos timestamps caem dentro de [now - windowMs, now]. */
export function countWithinWindow(
  timestamps: (Date | string)[],
  now: Date,
  windowMs: number,
): number {
  const cutoff = now.getTime() - windowMs;
  return timestamps.filter((t) => new Date(t).getTime() >= cutoff).length;
}

export function isRateLimited(
  failureTimestamps: (Date | string)[],
  now: Date,
  windowMs: number,
  maxFailures: number,
): boolean {
  return countWithinWindow(failureTimestamps, now, windowMs) >= maxFailures;
}

/**
 * Rate limit por (e-mail OU IP) + action, contando registros recentes em access_logs.
 *
 * Passe apenas uma das chaves (email ou ip) — a outra deve ser string vazia.
 *   - Por IP:     checkRateLimit('', req.ip, 'action', 60, 10)
 *   - Por e-mail: checkRateLimit(email, '', 'action', 60, 5)
 *
 * Retorna true se AINDA estiver dentro do limite (permitido) e false se bloqueado.
 * Em caso de erro de banco, retorna true (fail-open) para não derrubar fluxos críticos.
 */
export async function checkRateLimit(
  email: string,
  ip: string,
  action: string,
  windowMinutes: number,
  maxAttempts: number,
): Promise<boolean> {
  try {
    const interval = `${Math.max(1, Math.floor(windowMinutes))} minutes`;
    let sql: string;
    let params: any[];
    if (email) {
      sql = `SELECT count(*)::int AS n FROM access_logs
              WHERE action = $1
                AND created_at > now() - $2::interval
                AND (meta->>'email') = $3`;
      params = [action, interval, email];
    } else if (ip) {
      sql = `SELECT count(*)::int AS n FROM access_logs
              WHERE action = $1
                AND created_at > now() - $2::interval
                AND ip = $3`;
      params = [action, interval, ip];
    } else {
      return true;
    }
    const { rows } = await query(sql, params);
    const n = rows[0]?.n ?? 0;
    return n < maxAttempts;
  } catch (err) {
    console.error('checkRateLimit error:', err);
    return true; // fail-open
  }
}
