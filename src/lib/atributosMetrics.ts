// Métricas de atributos autoinformados (Certificações usam painelMetrics; aqui fica a Escolaridade).
// Puro e testável; o Painel agrega no cliente.

export function contarStatus(itens: { status: string }[]): { pendente: number; valido: number; reprovado: number; total: number } {
  const c = { pendente: 0, valido: 0, reprovado: 0, total: 0 };
  for (const it of itens) {
    if (it.status === 'pendente') c.pendente++;
    else if (it.status === 'valido') c.valido++;
    else if (it.status === 'reprovado') c.reprovado++;
    else continue; // status desconhecido não entra na contagem
    c.total++;
  }
  return c;
}

export function conformidadeStatus(itens: { status: string }[]): number {
  const c = contarStatus(itens);
  const base = c.valido + c.reprovado; // pendentes ficam de fora (ainda não analisados)
  return base === 0 ? 0 : Math.round((c.valido / base) * 100);
}

const NIVEIS_ORDEM = ['ensino_medio', 'tecnico', 'graduacao', 'especializacao', 'residencia', 'mestrado', 'doutorado', 'pos_doutorado'];

export function distribuicaoPorNivel(education: { nivel: string }[]): { nivel: string; n: number }[] {
  const cont = new Map<string, number>();
  for (const e of education) cont.set(e.nivel, (cont.get(e.nivel) ?? 0) + 1);
  return NIVEIS_ORDEM.filter(n => (cont.get(n) ?? 0) > 0).map(n => ({ nivel: n, n: cont.get(n)! }));
}
