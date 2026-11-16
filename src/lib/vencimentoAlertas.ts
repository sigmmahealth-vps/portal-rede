// Decide o marco de aviso de vencimento de um documento, a partir da data de validade
// e da data local de hoje. Puro e testável; o job (server.ts) injeta `hoje`.
// - vence em até 30 dias (inclusive hoje) → { 'vencendo', 'aviso30' } (aviso único).
// - já vencido, até o teto → { 'vencido', 'atraso:' + floor(diasVencido/3) } (marcos 0…9).
// - caso contrário → null. Datas comparadas só por YYYY-MM-DD local (sem drift de UTC).

export type MarcoVencimento = { tipo: 'vencendo' | 'vencido'; marco: string } | null;

export const TETO_AVISOS_VENCIDO = 10; // marcos 0…9 → avisos a cada 3 dias por ~30 dias

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function marcoVencimento(
  doc: { expiry_date: string | null | undefined },
  hoje: Date = new Date(),
): MarcoVencimento {
  if (!doc.expiry_date) return null;
  const hojeStr = ymdLocal(hoje);
  const exp = doc.expiry_date.slice(0, 10);

  if (exp >= hojeStr) {
    // vence hoje ou no futuro: só avisa dentro da janela de 30 dias.
    const limite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 30);
    if (exp <= ymdLocal(limite)) return { tipo: 'vencendo', marco: 'aviso30' };
    return null;
  }

  // já vencido: dias inteiros de atraso pela diferença de datas locais (meia-noite).
  const [ey, em, ed] = exp.split('-').map(Number);
  const expMid = new Date(ey, em - 1, ed);
  const hojeMid = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diasVencido = Math.round((hojeMid.getTime() - expMid.getTime()) / 86400000);
  const n = Math.floor(diasVencido / 3);
  if (n < TETO_AVISOS_VENCIDO) return { tipo: 'vencido', marco: `atraso:${n}` };
  return null;
}
