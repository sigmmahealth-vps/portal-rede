// src/lib/certValidity.ts
import { addYears, format, parseISO } from 'date-fns';

/**
 * Validade do certificado (spec 5.4.5): end_date do ciclo + 1 ano.
 * Fallback (instância sem ciclo): data de aprovação + 1 ano.
 *
 * cycleEndDate pode chegar como 'YYYY-MM-DD' (SQL) ou Date (driver pg).
 * String date-only DEVE ser parseada com parseISO (meia-noite local) —
 * `new Date('2026-12-31')` seria UTC e regrediria um dia em UTC-3.
 */
export function computeValidUntil(
  cycleEndDate: string | Date | null,
  fallback: Date,
): string {
  const base = cycleEndDate == null
    ? fallback
    : typeof cycleEndDate === 'string' ? parseISO(cycleEndDate) : cycleEndDate;
  return format(addYears(base, 1), 'yyyy-MM-dd');
}
