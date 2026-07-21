import XLSX from 'xlsx';

export interface XlsxSourceRow {
  provider_name: string;
  provider_code: string | null;
  city: string | null;
  address: string | null;
  percentual: number;
  seal: string | null;
  started_at: string | null;
  completed_at: string | null;
  status: string;
}

export const AUDITOR_XLSX_HEADERS = [
  'Município', 'Logradouro', 'Prestador', 'Código',
  'Pontuação Total', 'Classificação',
  '% Segurança', '% Conforto', '% Experiência do Cliente',
  'Data de Envio', 'Data de Conclusão da Análise',
] as const;

const FINAL_STATUSES = new Set(['aprovado', 'reprovado', 'finalizado']);

export function buildAuditorXlsxRows(
  instances: (XlsxSourceRow & { id: number })[],
  dimPctByInstance: Record<number, Record<string, number>>,
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [[...AUDITOR_XLSX_HEADERS]];
  for (const i of instances) {
    const dims = dimPctByInstance[i.id] || {};
    const pct = (name: string) => (dims[name] != null ? dims[name] : null);
    rows.push([
      i.city ?? null,
      i.address ?? null,
      i.provider_name,
      i.provider_code ?? null,
      Number(i.percentual) || 0,
      i.seal ?? null,
      pct('Segurança'),
      pct('Conforto'),
      pct('Experiência do Cliente'),
      i.started_at ?? null,
      FINAL_STATUSES.has(i.status) ? (i.completed_at ?? null) : null,
    ]);
  }
  return rows;
}

export function serializeAuditorXlsx(rows: (string | number | null)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Painel do Ciclo');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
