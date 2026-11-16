import { statusDocumento } from './documentoStatus.js';

export type Situacao = 'regular' | 'vencendo' | 'irregular' | 'pendente' | 'historico';

// Data local +N dias em YYYY-MM-DD.
function maisDias(hoje: Date, dias: number): string {
  const d = new Date(hoje); d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function situacaoDocumento(doc: { status: string; expiry_date?: string | null }, hoje: Date = new Date()): Situacao {
  const st = statusDocumento({ status: doc.status, expiry_date: doc.expiry_date }, hoje);
  if (st === 'historico') return 'historico';
  if (st === 'pendente') return 'pendente';
  if (st === 'reprovado' || st === 'vencido') return 'irregular';
  // aprovado (válido, validade >= hoje ou ausente)
  if (doc.expiry_date && String(doc.expiry_date).slice(0, 10) <= maisDias(hoje, 30)) return 'vencendo';
  return 'regular';
}

export interface Contagem { regular: number; vencendo: number; irregular: number; pendente: number; total: number }

export function contarSituacoes(docs: any[], hoje: Date = new Date()): Contagem {
  const c: Contagem = { regular: 0, vencendo: 0, irregular: 0, pendente: 0, total: 0 };
  for (const d of docs) {
    const s = situacaoDocumento(d, hoje);
    if (s === 'historico') continue;
    (c as any)[s]++; c.total++;
  }
  return c;
}

export function conformidade(docs: any[], hoje: Date = new Date()): number {
  const c = contarSituacoes(docs, hoje);
  const conforme = c.regular + c.vencendo;
  const denom = conforme + c.irregular;
  return denom === 0 ? 0 : Math.round((conforme / denom) * 100);
}

export function baldesAlvara(docs: any[], tipoNome: string, hoje: Date = new Date()) {
  const c = contarSituacoes(docs.filter(d => d.type === tipoNome), hoje);
  return { noPrazo: c.regular, aVencer: c.vencendo, vencido: c.irregular };
}

export function conformidadePorTipo(docs: any[], tipoNome: string, hoje: Date = new Date()) {
  const c = contarSituacoes(docs.filter(d => d.type === tipoNome), hoje);
  const conforme = c.regular + c.vencendo;
  const total = conforme + c.irregular;
  return { conforme, total, pct: total === 0 ? 0 : Math.round((conforme / total) * 100) };
}
