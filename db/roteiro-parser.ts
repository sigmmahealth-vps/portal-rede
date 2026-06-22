/**
 * Parser puro dos roteiros de qualificação (WS4).
 *
 * Extraído de db/import-roteiros.ts para ser reutilizável tanto pelo CLI
 * (lê o arquivo do disco) quanto pelo servidor (upload em memória).
 *
 * Não faz I/O de disco nem acesso a banco: recebe o conteúdo do .xlsx como
 * Buffer e devolve um ParsedScript. O layout de colunas não é fixo — as colunas
 * são detectadas a partir do cabeçalho ("PESO MÁXIMO"/"PESO À CONSIDERAR") e a
 * coluna de evidência é sempre (PESO MÁXIMO - 1).
 */
import XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Converte célula numérica ("10", "10,5", "") em número ou null. */
export function num(v: unknown): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s.replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const CLASS_LABELS: Record<string, string> = {
  S: 'Segurança',
  C: 'Conforto',
  E: 'Experiência do Cliente',
  DL: 'Documento Legal',
};
const mapClass = (c: string): string => CLASS_LABELS[c.toUpperCase()] ?? c;

/** Extrai referências normativas grosseiras do texto do critério. */
function extractLegislation(text: string): string | null {
  const m = text.match(/\b(ANS|ANVISA|RDC|RN|CFM|CRM|COREN|Lei|Portaria|Minist[ée]rio)\b[^."]{0,60}/gi);
  if (!m) return null;
  const uniq = Array.from(new Set(m.map((s) => s.trim())));
  return uniq.join('; ').slice(0, 300) || null;
}

// padrões de linha (col A)
const RE_QUESTION = /^(\d+(?:\.\d+){2,})\s*[.)]?\s+(.+)/s; // 1.1.1 ...
const RE_SUBSECTION = /^(\d+\.\d+)(?!\.\d)\.?\s+(.+)/s; //     1.1 ... (2 níveis)
const RE_SECTION = /^SE[ÇC][ÃA]O\s+([\d.]+)\.?\s*(.*)/i; //    SEÇÃO 1. ...
const RE_FOOTER = /^(TOTAL|PONTUA[ÇC][ÃA]O|RESULTADO|CLASSIFICA[ÇC]|ASSINATURA|RESPONS[ÁA]VEL|LEGENDA|DATA\b)/i;
const RE_DATAENTRY = /^(N[úu]mero\b|Quantidade\b|Outros\b|Nome\b|Especialidade|Endere[çc]o|Telefone|E-?mail|Munic[íi]pio|WhatsApp|C[óo]digo\b|Registro\b)/i;

// ---------------------------------------------------------------------------
// tipos do resultado de parse
// ---------------------------------------------------------------------------
export interface SectionNode {
  tmp: number;
  parentTmp: number | null;
  name: string;
  depth: number;
  order: number;
}
export interface QuestionNode {
  sectionTmp: number | null;
  code: string | null;
  text: string;
  guidance: string | null;
  dimension: string | null;
  legislation: string | null;
  weight: number;
  maxScore: number;
  evidenceRequired: boolean;
  isEliminatory: boolean;
  order: number;
}
export interface ParsedScript {
  sourceFile: string;
  opsCode: string;
  title: string;
  description: string;
  version: string;
  revisaoDate: string | null;
  sheetName: string;
  sections: SectionNode[];
  questions: QuestionNode[];
  orphans: string[];
}

// ---------------------------------------------------------------------------
// parser
// ---------------------------------------------------------------------------
function findHeader(rows: string[][]) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const colMax = r.findIndex((c) => /PESO\s*M[ÁA]XIMO/i.test(c));
    const colCons = r.findIndex((c) => /CONSIDERAR/i.test(c));
    if (colMax >= 0 && colCons >= 0) {
      const colClass = r.findIndex((c) => /Quesitos/i.test(c));
      return { headerRow: i, colMax, colCons, colEvid: colMax - 1, colClass };
    }
  }
  return null;
}

function looksLikeGroup(text: string): boolean {
  if (!text || /^\d/.test(text)) return false;
  if (/^SE[ÇC][ÃA]O/i.test(text)) return false;
  if (RE_FOOTER.test(text)) return false;
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 4) return false;
  return letters === letters.toUpperCase();
}

/**
 * Faz o parse de um workbook .xlsx (em Buffer) para ParsedScript.
 * @param buffer    conteúdo binário do .xlsx
 * @param sourceFile nome do arquivo de origem (ex.: "OPS-RED-FOR-017 - Clínicas.xlsx")
 */
export function parseWorkbook(buffer: Buffer, sourceFile: string): ParsedScript {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: '',
  }) as unknown[][];
  const rows: string[][] = raw.map((r) => r.map(clean));

  const base = sourceFile.replace(/\.[^.]+$/, '');
  const opsCode = (base.match(/OPS-RED-FOR-\d+/i)?.[0] ?? base).toUpperCase();
  const tipo = base.split(' - ').pop()?.trim() || base;

  const titleCell = rows[0]?.find((c) => /ROTEIRO PARA AVALIA/i.test(c)) ?? '';
  const metaCell = rows[0]?.find((c) => /OPS-?REDS?/i.test(c)) ?? '';
  const revMatch = metaCell.match(/Revis[ãa]o:\s*(\d+)(?:\s+em\s+(\d{2})\/(\d{2})\/(\d{4}))?/i);
  const revisao = revMatch?.[1] ?? '00';
  // data "DD/MM/YYYY" → ISO "YYYY-MM-DD" (apenas quando presente)
  const revisaoDate = revMatch && revMatch[2] ? `${revMatch[4]}-${revMatch[3]}-${revMatch[2]}` : null;

  const hdr = findHeader(rows);

  const sections: SectionNode[] = [];
  const questions: QuestionNode[] = [];
  const orphans: string[] = [];

  let tmpSeq = 0;
  const stack: { tmp: number; depth: number }[] = [];
  const orderByParent = new Map<number | null, number>();
  const orderBySection = new Map<number | null, number>();

  function nextOrder(map: Map<number | null, number>, key: number | null): number {
    const n = (map.get(key) ?? 0) + 1;
    map.set(key, n);
    return n;
  }

  function pushSection(depth: number, name: string): number {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parentTmp = stack.length ? stack[stack.length - 1].tmp : null;
    const tmp = tmpSeq++;
    sections.push({ tmp, parentTmp, name, depth, order: nextOrder(orderByParent, parentTmp) });
    stack.push({ tmp, depth });
    return tmp;
  }

  if (!hdr) {
    orphans.push('!! cabeçalho de colunas (PESO MÁXIMO/CONSIDERAR) não encontrado');
    return { sourceFile, opsCode, title: `${opsCode} — ${tipo}`, description: titleCell, version: revisao, revisaoDate, sheetName, sections, questions, orphans };
  }

  const h = hdr;

  for (let i = h.headerRow - 1; i >= 0; i--) {
    const a = rows[i]?.[0] ?? '';
    if (looksLikeGroup(a)) {
      pushSection(0, a);
      break;
    }
    if (/^IDENTIFICA|^Operadora/i.test(a)) break;
  }

  const addQuestion = (code: string | null, text: string, row: string[], a: string): void => {
    const sectionTmp = stack.length ? stack[stack.length - 1].tmp : null;
    const guidance = clean(row[h.colEvid]) || null;
    const maxScore = num(row[h.colMax]) ?? 0;
    const weight = num(row[h.colCons]) ?? maxScore;
    const classCell = h.colClass >= 0 ? clean(row[h.colClass]) : '';
    const markMatch = text.match(/"\s*(DL|S|C|E)\s*"/i);
    const dimension = classCell ? mapClass(classCell) : markMatch ? mapClass(markMatch[1]) : null;
    questions.push({
      sectionTmp,
      code: code || null,
      text,
      guidance,
      dimension,
      legislation: extractLegislation(text),
      weight,
      maxScore,
      evidenceRequired: !!guidance,
      isEliminatory: /mandat[óo]ri|eliminat[óo]ri/i.test(a),
      order: nextOrder(orderBySection, sectionTmp),
    });
  };

  for (let i = h.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const a = row[0] ?? '';
    if (!a) continue;

    const mSection = a.match(RE_SECTION);
    const mQuestion = a.match(RE_QUESTION);
    const mSub = a.match(RE_SUBSECTION);

    if (mSection) {
      pushSection(1, a);
      continue;
    }
    if (mQuestion) {
      addQuestion(mQuestion[1], mQuestion[2].trim(), row, a);
      continue;
    }
    if (mSub) {
      pushSection(2, a);
      continue;
    }
    if (RE_FOOTER.test(a)) continue;
    if (looksLikeGroup(a)) {
      pushSection(0, a);
      continue;
    }
    if (
      (num(row[h.colMax]) != null || num(row[h.colCons]) != null) &&
      a.length > 8 &&
      !RE_DATAENTRY.test(a)
    ) {
      addQuestion(null, a, row, a);
      continue;
    }
    if (a.length > 2) orphans.push(`r${i}: ${a.slice(0, 70)}`);
  }

  return {
    sourceFile,
    opsCode,
    title: `${opsCode} — ${tipo}`,
    description: titleCell,
    version: revisao,
    revisaoDate,
    sheetName,
    sections,
    questions,
    orphans,
  };
}
