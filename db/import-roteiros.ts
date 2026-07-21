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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkbook, type ParsedScript } from './roteiro-parser.js';

// ---------------------------------------------------------------------------
// localização dos arquivos
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ROTEIROS_DIR = process.env.ROTEIROS_DIR || path.resolve(PROJECT_ROOT, '..', 'rota-qualificacao');

/** Lê o .xlsx do disco e delega ao parser compartilhado. */
function parseFile(file: string): ParsedScript {
  return parseWorkbook(fs.readFileSync(file), path.basename(file));
}

// ---------------------------------------------------------------------------
// gravação (commit)
// ---------------------------------------------------------------------------
async function commitScript(parsed: ParsedScript): Promise<number> {
  const { withTransaction } = await import('./db.js');
  return withTransaction(async (client) => {
    // idempotência: recarrega substituindo a versão anterior do mesmo arquivo
    await client.query('DELETE FROM eval_scripts WHERE source_file = $1', [parsed.sourceFile]);
    const revisaoDate = parsed.revisaoDate ?? parsed.implantacaoDate;
    if (!revisaoDate) {
      throw new Error(`${parsed.sourceFile}: sem data de revisão nem de implantação — não é possível gravar revisao_date`);
    }
    const { rows } = await client.query(
      `INSERT INTO eval_scripts (title, description, version, source_file, revisao_date, implantacao_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
      [parsed.title, parsed.description, parsed.version, parsed.sourceFile, revisaoDate, parsed.implantacaoDate],
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
           (section_id, code, text, legislation, type, weight, max_score, dimension, document_type,
            guidance, evidence_required, is_eliminatory, order_index)
         VALUES ($1,$2,$3,$4,'sim_nao',$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          sectionId, q.code, q.text, q.legislation, q.weight, q.maxScore,
          q.dimension, q.documentType, q.guidance, q.evidenceRequired, q.isEliminatory, q.order,
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
