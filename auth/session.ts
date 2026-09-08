// Política de sessão (spec 2026-09-08): sessão deslizante com teto absoluto e
// revogação no servidor por users.session_version. Só a lógica pura fica aqui;
// o middleware em server.ts monta e confere o JWT.

export interface SessionConfig {
  idleMs: number; // janela de inatividade — vira o `exp` do JWT e o maxAge do cookie
  maxMs: number;  // teto absoluto desde o login (claim `sa`)
}

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_MAX_HOURS = 8;

function positiveOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseSessionConfig(env: NodeJS.ProcessEnv = process.env): SessionConfig {
  return {
    idleMs: positiveOr(env.SESSION_IDLE_MINUTES, DEFAULT_IDLE_MINUTES) * 60 * 1000,
    maxMs: positiveOr(env.SESSION_MAX_HOURS, DEFAULT_MAX_HOURS) * 60 * 60 * 1000,
  };
}

export const SESSION = parseSessionConfig();

/** Teto absoluto: `sa` (início da sessão, epoch ms) + maxMs. Sem `sa` = expirado. */
export function isAbsoluteExpired(sessionStartMs: unknown, now: Date, maxMs: number = SESSION.maxMs): boolean {
  if (typeof sessionStartMs !== 'number' || !Number.isFinite(sessionStartMs)) return true;
  return now.getTime() - sessionStartMs > maxMs;
}

/** Revogação: a claim `sv` do token precisa bater com users.session_version. Sem `sv` = revogado. */
export function isRevoked(tokenSv: unknown, dbSv: number): boolean {
  return typeof tokenSv !== 'number' || tokenSv !== dbSv;
}
