/**
 * Importador dos roteiros de qualificação (WS4).
 *
 * Lê os arquivos .xlsx em ../rota-qualificacao e carrega-os nas tabelas
 *   eval_scripts  (1 por arquivo)
 *   eval_sections (GRUPO -> SEÇÃO -> subseção, via parent_section_id)
 *   eval_questions (critérios "x.y.z", com peso, evidência, dimensão)
 *
 * Os roteiros NÃO têm layout de colunas fixo (o de Hospitais tem uma coluna
 * "Quesitos" a mais que desloca tudo). Por isso as colunas são detectadas
 * dinamicamente a partir da linha de cabeçalho ("PESO MÁXIMO"/"PESO À
 * CONSIDERAR"); a coluna de evidência é sempre (PESO MÁXIMO - 1).
 *
 * Uso:
 *   tsx db/import-roteiros.ts                 # dry-run: só relatório, não grava
 *   tsx db/import-roteiros.ts --file FOR-017  # dry-run de um arquivo (substring)
 *   tsx db/import-roteiros.ts --commit        # grava no Postgres (idempotente por source_file)
 */
import XLSX from 'xlsx';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// localização dos arquivos
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ROTEIROS_DIR = process.env.ROTEIROS_DIR || path.resolve(PROJECT_ROOT, '..', 'rota-qualificacao');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Converte célula numérica ("10", "10,5", "") em número ou null. */
function num(v: unknown): number | null {
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
// rodapés/linhas de fechamento que NÃO são conteúdo do roteiro
const RE_FOOTER = /^(TOTAL|PONTUA[ÇC][ÃA]O|RESULTADO|CLASSIFICA[ÇC]|ASSINATURA|RESPONS[ÁA]VEL|LEGENDA|DATA\b)/i;
// campos de preenchimento/identificação (quadro de pessoal etc.) — não são critérios
const RE_DATAENTRY = /^(N[úu]mero\b|Quantidade\b|Outros\b|Nome\b|Especialidade|Endere[çc]o|Telefone|E-?mail|Munic[íi]pio|WhatsApp|C[óo]digo\b|Registro\b)/i;

// ---------------------------------------------------------------------------
// tipos do resultado de parse
// ---------------------------------------------------------------------------
interface SectionNode {
  tmp: number;
  parentTmp: number | null;
  name: string;
  depth: number;
  order: number;
}
interface QuestionNode {
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
interface ParsedScript {
  sourceFile: string;
  opsCode: string;
  title: string;
  description: string;
  version: string;
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
  // caixa-alta (sem minúsculas) => grupo/dimensão
  return letters === letters.toUpperCase();
}

function parseFile(file: string): ParsedScript {
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: '',
  }) as unknown[][];
  const rows: string[][] = raw.map((r) => r.map(clean));

  const base = path.basename(file, path.extname(file));
  const opsCode = (base.match(/OPS-RED-FOR-\d+/i)?.[0] ?? base).toUpperCase();
  const tipo = base.split(' - ').pop()?.trim() || base;

  // meta do cabeçalho (revisão / título completo)
  const titleCell = rows[0]?.find((c) => /ROTEIRO PARA AVALIA/i.test(c)) ?? '';
  const metaCell = rows[0]?.find((c) => /OPS-?REDS?/i.test(c)) ?? '';
  const revisao = metaCell.match(/Revis[ãa]o:\s*(\d+)/i)?.[1] ?? '00';

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
    return { sourceFile: path.basename(file), opsCode, title: `${opsCode} — ${tipo}`, description: titleCell, version: revisao, sheetName, sections, questions, orphans };
  }

  // grupo inicial = linha de caixa-alta logo antes do cabeçalho
  for (let i = hdr.headerRow - 1; i >= 0; i--) {
    const a = rows[i]?.[0] ?? '';
    if (looksLikeGroup(a)) {
      pushSection(0, a);
      break;
    }
    if (/^IDENTIFICA|^Operadora/i.test(a)) break;
  }

  for (let i = hdr.headerRow + 1; i < rows.length; i++) {
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
    function addQuestion(code: string | null, text: string): void {
      const sectionTmp = stack.length ? stack[stack.length - 1].tmp : null;
      const guidance = clean(row[hdr!.colEvid]) || null;
      const maxScore = num(row[hdr!.colMax]) ?? 0;
      const weight = num(row[hdr!.colCons]) ?? maxScore;
      const classCell = hdr!.colClass >= 0 ? clean(row[hdr!.colClass]) : '';
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
    }

    if (mQuestion) {
      addQuestion(mQuestion[1], mQuestion[2].trim());
      continue;
    }
    if (mSub) {
      pushSection(2, a);
      continue;
    }
    if (RE_FOOTER.test(a)) continue; // TOTAL/PONTUAÇÃO/etc. → ignora
    if (looksLikeGroup(a)) {
      pushSection(0, a);
      continue;
    }
    // critério sem numeração porém pontuado (ex.: "Participação da pesquisa...")
    // — exclui campos de preenchimento (Número de.../Outros/etc.)
    if (
      (num(row[hdr.colMax]) != null || num(row[hdr.colCons]) != null) &&
      a.length > 8 &&
      !RE_DATAENTRY.test(a)
    ) {
      addQuestion(null, a);
      continue;
    }
    // notas / campos de identificação / continuação → não classificado
    if (a.length > 2) orphans.push(`r${i}: ${a.slice(0, 70)}`);
  }

  return {
    sourceFile: path.basename(file),
    opsCode,
    title: `${opsCode} — ${tipo}`,
    description: titleCell,
    version: revisao,
    sheetName,
    sections,
    questions,
    orphans,
  };
}

// ---------------------------------------------------------------------------
// gravação (commit)
// ---------------------------------------------------------------------------
async function commitScript(parsed: ParsedScript): Promise<number> {
  const { withTransaction } = await import('./db.js');
  return withTransaction(async (client) => {
    // idempotência: recarrega substituindo a versão anterior do mesmo arquivo
    await client.query('DELETE FROM eval_scripts WHERE source_file = $1', [parsed.sourceFile]);
    const { rows } = await client.query(
      `INSERT INTO eval_scripts (title, description, version, source_file, created_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [parsed.title, parsed.description, parsed.version, parsed.sourceFile],
    );
    const scriptId = rows[0].id as number;

    const idByTmp = new Map<number, number>();
    for (const s of parsed.sections) {
      const parentId = s.parentTmp != null ? idByTmp.get(s.parentTmp) ?? null : null;
      const { rows: sr } = await client.query(
        `INSERT INTO eval_sections (script_id, parent_section_id, name, order_index)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [scriptId, parentId, s.name, s.order],
      );
      idByTmp.set(s.tmp, sr[0].id);
    }

    for (const q of parsed.questions) {
      const sectionId = q.sectionTmp != null ? idByTmp.get(q.sectionTmp) ?? null : null;
      if (sectionId == null) continue; // critério sem seção: ignora (não deveria ocorrer)
      await client.query(
        `INSERT INTO eval_questions
           (section_id, code, text, legislation, type, weight, max_score, dimension,
            guidance, evidence_required, is_eliminatory, order_index)
         VALUES ($1,$2,$3,$4,'sim_nao',$5,$6,$7,$8,$9,$10,$11)`,
        [
          sectionId, q.code, q.text, q.legislation, q.weight, q.maxScore,
          q.dimension, q.guidance, q.evidenceRequired, q.isEliminatory, q.order,
        ],
      );
    }
    return scriptId;
  });
}

// ---------------------------------------------------------------------------
// relatório dry-run
// ---------------------------------------------------------------------------
function report(p: ParsedScript): void {
  const totalMax = p.questions.reduce((s, q) => s + q.maxScore, 0);
  const dims = new Map<string, number>();
  for (const q of p.questions) {
    const k = q.dimension ?? '(sem)';
    dims.set(k, (dims.get(k) ?? 0) + 1);
  }
  console.log(`\n=== ${p.title}`);
  console.log(`    arquivo: ${p.sourceFile}  | aba: "${p.sheetName}"  | revisão: ${p.version}`);
  console.log(`    seções: ${p.sections.length}  | critérios: ${p.questions.length}  | pontuação máx. total: ${totalMax}`);
  console.log(`    dimensões: ${Array.from(dims).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  const noGuide = p.questions.filter((q) => !q.guidance).length;
  const noWeight = p.questions.filter((q) => !q.maxScore).length;
  if (noGuide) console.log(`    ⚠ critérios sem evidência: ${noGuide}`);
  if (noWeight) console.log(`    ⚠ critérios sem peso máximo: ${noWeight}`);
  if (p.orphans.length) {
    console.log(`    ⚠ linhas não classificadas: ${p.orphans.length}`);
    for (const o of p.orphans.slice(0, 8)) console.log(`        ${o}`);
    if (p.orphans.length > 8) console.log(`        ... (+${p.orphans.length - 8})`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

  if (!fs.existsSync(ROTEIROS_DIR)) {
    console.error(`Diretório de roteiros não encontrado: ${ROTEIROS_DIR}`);
    process.exit(1);
  }
  let files = fs
    .readdirSync(ROTEIROS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .sort();
  if (fileArg) files = files.filter((f) => f.toLowerCase().includes(fileArg.toLowerCase()));

  console.log(`Roteiros em: ${ROTEIROS_DIR}`);
  console.log(`Arquivos: ${files.length}  | modo: ${commit ? 'COMMIT (grava no banco)' : 'DRY-RUN (não grava)'}`);

  let totalQ = 0;
  let failures = 0;
  for (const f of files) {
    const full = path.join(ROTEIROS_DIR, f);
    try {
      const parsed = parseFile(full);
      report(parsed);
      totalQ += parsed.questions.length;
      if (parsed.questions.length === 0) failures++;
      if (commit) {
        const id = await commitScript(parsed);
        console.log(`    ✔ gravado: eval_scripts.id = ${id}`);
      }
    } catch (err: any) {
      failures++;
      console.error(`    ✖ ERRO em ${f}: ${err.message}`);
    }
  }

  console.log(`\n----------------------------------------------------------`);
  console.log(`Total: ${files.length} roteiros, ${totalQ} critérios.` + (failures ? ` ⚠ ${failures} com problema.` : ' ✔ todos parseados.'));
  if (!commit) console.log(`Dry-run. Para gravar: tsx db/import-roteiros.ts --commit`);

  if (commit) {
    const { pool } = await import('./db.js');
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
