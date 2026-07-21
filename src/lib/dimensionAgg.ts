export interface DimTotals {
  dimension: string;
  score: number;
  max_possible: number;
}

/**
 * Consolida "Documento Legal" em "Segurança" (spec 5.4.2.3 observação):
 * DL faz parte da nota de Segurança, não é uma dimensão separada no relatório.
 * Somam-se `score` e `max_possible` das duas dimensões; percentual é derivado
 * quando o consumidor precisar (score/max_possible*100).
 */
export function mergeSecurityDL(rows: DimTotals[]): DimTotals[] {
  const dl = rows.find(r => r.dimension === 'Documento Legal');
  if (!dl) return rows;
  const seg = rows.find(r => r.dimension === 'Segurança');
  const others = rows.filter(r => r.dimension !== 'Documento Legal' && r.dimension !== 'Segurança');
  const merged: DimTotals = {
    dimension: 'Segurança',
    score: (seg?.score ?? 0) + dl.score,
    max_possible: (seg?.max_possible ?? 0) + dl.max_possible,
  };
  return [merged, ...others];
}
