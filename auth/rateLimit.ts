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
