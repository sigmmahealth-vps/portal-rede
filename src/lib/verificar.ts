// Verificar: a partir dos documentos de um prestador e dos tipos obrigatórios da sua função,
// quais documentos obrigatórios estão sem um doc aprovado e vigente, e por quê.
// Puro; reusa statusDocumento. O chamador (server) já filtra documentos 'historico'.
import { statusDocumento, type StatusDoc } from './documentoStatus.js';

export type MotivoFaltante = 'ausente' | 'vencido' | 'reprovado' | 'pendente';
export type Faltante = { type_id: number; motivo: MotivoFaltante };

// upload_date pode vir como string (ISO) ou Date (o pg devolve timestamptz como Date).
type DocLite = { type_id: number | null; status: string; expiry_date: string | null; upload_date?: string | Date | null };

// Status efetivo "melhor" por tipo: 'aprovado' vence; senão o status do doc de maior upload_date.
export function statusPorTipo(docs: DocLite[], hoje: Date = new Date()): Map<number, StatusDoc> {
  const aprovado = new Set<number>();
  const melhor = new Map<number, DocLite>();
  for (const d of docs) {
    if (d.type_id == null) continue;
    const id = d.type_id;
    if (statusDocumento(d, hoje) === 'aprovado') { aprovado.add(id); continue; }
    if (aprovado.has(id)) continue;
    const atual = melhor.get(id);
    // Compara por timestamp (upload_date pode ser Date ou string ISO) — não por texto.
    if (!atual || new Date(d.upload_date ?? 0).getTime() > new Date(atual.upload_date ?? 0).getTime()) melhor.set(id, d);
  }
  const out = new Map<number, StatusDoc>();
  for (const id of aprovado) out.set(id, 'aprovado');
  for (const [id, d] of melhor) if (!out.has(id)) out.set(id, statusDocumento(d, hoje));
  return out;
}

// Tipos obrigatórios sem status 'aprovado' → faltantes (ordenados por type_id).
export function faltantesPara(requiredTypeIds: Iterable<number>, porTipo: Map<number, StatusDoc>): Faltante[] {
  const out: Faltante[] = [];
  for (const id of requiredTypeIds) {
    const s = porTipo.get(id);
    if (s === 'aprovado') continue;
    const motivo: MotivoFaltante = (s === 'vencido' || s === 'reprovado' || s === 'pendente') ? s : 'ausente';
    out.push({ type_id: id, motivo });
  }
  out.sort((a, b) => a.type_id - b.type_id);
  return out;
}
