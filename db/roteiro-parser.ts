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

// A "pesquisa de satisfação da qualificação da rede" não faz mais parte do roteiro:
// é coletada pelo módulo de Pesquisa, não como critério avaliável. Filtrada no
// import para não voltar em reimports (migration 0026 remove as já existentes).
export const isPesquisaSatisfacao = (text: string): boolean =>
  /pesquisa de satisfa[çc][ãa]o da qualifica[çc][ãa]o da rede/i.test(text || '');

/** Extrai referências normativas grosseiras do texto do critério. */
function extractLegislation(text: string): string | null {
  const m = text.match(/\b(ANS|ANVISA|RDC|RN|CFM|CRM|COREN|Lei|Portaria|Minist[ée]rio)\b[^."]{0,60}/gi);
  if (!m) return null;
  const uniq = Array.from(new Set(m.map((s) => s.trim())));
  return uniq.join('; ').slice(0, 300) || null;
}

/**
 * Extrai um "tipo de documento" normalizado a partir do texto do critério + guidance,
 * usado pelo bypass DL (spec 5.4.2.3). Só faz sentido quando dimension='Documento Legal';
 * o chamador é responsável por só usar o valor nesse caso.
 * Regras aplicadas em ordem — primeira match ganha. Retorna null se nenhuma bate.
 */
export function extractDocumentType(text: string, guidance: string | null | undefined): string | null {
  const haystack = `${text} ${guidance ?? ''}`;
  const H = haystack.toLowerCase();
  // ORDER MATTERS — mais específico antes do genérico (PGRSS antes de PGR).
  // Labels alinhados ao dropdown de upload em src/pages/Documentos.tsx:546-556.
  // Sem esse alinhamento, o DL bypass da Task 4 faria zero match em produção.
  if (/alvar[áa]\s+sanit[áa]rio/.test(H)) return 'Alvará Sanitário';
  if (/alvar[áa]\s+de\s+(funcionamento|localiza[çc][ãa]o)/.test(H)) return 'Alvará de Localização';
  if (/corpo\s+de\s+bombeiros|\bavcb\b/.test(H)) return 'Alvará dos Bombeiros';
  if (/\bcnes\b|cadastro\s+nacional\s+(de\s+)?estabelecimento/.test(H)) return 'CNES';
  // ART: só bate na forma completa (não usa \bart\b, pois "art. 968" — abreviação de artigo
  // de lei — vive nos critérios DL e roubava o match antes de Contrato Social/PGR/etc.).
  if (/anota[çc][ãa]o\s+de\s+responsabilidade\s+t[ée]cnica/.test(H)) return 'ART - Anotação de Responsabilidade Técnica';
  if (/\bpgrss\b|res[íi]duos\s+de\s+servi[çc]os\s+de\s+sa[úu]de/.test(H)) return 'PGRSS';
  if (/\bpgr\b/.test(H)) return 'PGR';
  if (/\bpcmso\b|controle\s+m[ée]dico\s+e\s+sa[úu]de\s+ocupacional/.test(H)) return 'PCMSO';
  if (/contrato\s+social/.test(H)) return 'Contrato Social';
  if (/\brqe\b|registro\s+de\s+qualifica[çc][ãa]o\s+de\s+especialista/.test(H)) return 'RQE';
  return null;
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
  documentType: string | null;
  legislation: string | null;
  weight: number;
  maxScore: number;
  evidenceRequired: boolean;
  order: number;
}
/**
 * Roteiro sem revisão no cabeçalho = documento original: revisão "00" e data
 * herdada da Implantação (regra de negócio da recarga 2026-07-16; ex.: FOR-024,
 * cujo cabeçalho traz "Revisão:" vazio). Usar em TODO importador — a validação
 * de obrigatoriedade fica só sobre a data de implantação.
 */
export function effectiveRevision(p: Pick<ParsedScript, 'version' | 'revisaoDate' | 'implantacaoDate'>): { version: string; revisaoDate: string | null } {
  return { version: p.version ?? '00', revisaoDate: p.revisaoDate ?? p.implantacaoDate };
}

export interface ParsedScript {
  sourceFile: string;
  opsCode: string;
  title: string;
  description: string;
  version: string | null;
  revisaoDate: string | null;
  implantacaoDate: string | null;
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
  const revMatch = metaCell.match(/Revis[ãa]o:\s*(\d+)(?![\d/])(?:\s+em\s+(\d{2})\/(\d{2})\/(\d{4}))?/i);
  const revisao = revMatch?.[1] ?? null; // revisão é obrigatória; ausência = null (validado no import)
  // data "DD/MM/YYYY" → ISO "YYYY-MM-DD" (apenas quando presente)
  const revisaoDate = revMatch && revMatch[2] ? `${revMatch[4]}-${revMatch[3]}-${revMatch[2]}` : null;
  const implMatch = metaCell.match(/Implanta[çc][ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const implantacaoDate = implMatch ? `${implMatch[3]}-${implMatch[2]}-${implMatch[1]}` : null;

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
    return { sourceFile, opsCode, title: `${opsCode} — ${tipo}`, description: titleCell, version: revisao, revisaoDate, implantacaoDate, sheetName, sections, questions, orphans };
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

  const addQuestion = (code: string | null, text: string, row: string[]): void => {
    if (isPesquisaSatisfacao(text)) return; // fora do roteiro (coletada pelo módulo de Pesquisa)
    const sectionTmp = stack.length ? stack[stack.length - 1].tmp : null;
    const guidance = clean(row[h.colEvid]) || null;
    const maxScore = num(row[h.colMax]) ?? 0;
    const weight = num(row[h.colCons]) ?? maxScore;
    const classCell = h.colClass >= 0 ? clean(row[h.colClass]) : '';
    // ponytail: hoje S/DL/E/C só alimenta `dimension`; o tipo de resposta é sempre
    // tratado como sim_nao no import. Adiado: ler a coluna "Tipo" e emitir o tipo real
    // (numerico/data/texto/upload/DL) — ver spec 5.4.3.3 e docs/superpowers/specs/2026-07-09-qualificacao-admin-prestador-design.md.
    const markMatch = text.match(/"\s*(DL|S|C|E)\s*"/i);
    const dimension = classCell ? mapClass(classCell) : markMatch ? mapClass(markMatch[1]) : null;
    questions.push({
      sectionTmp,
      code: code || null,
      text,
      guidance,
      dimension,
      documentType: dimension === 'Documento Legal' ? extractDocumentType(text, guidance) : null,
      legislation: extractLegislation(text),
      weight,
      maxScore,
      evidenceRequired: !!guidance,
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
      addQuestion(mQuestion[1], mQuestion[2].trim(), row);
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
      addQuestion(null, a, row);
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
    implantacaoDate,
    sheetName,
    sections,
    questions,
    orphans,
  };
}
