/**
 * Apaga ciclos de qualificação de TESTE do dev (label em CICLOS) e tudo que depende deles,
 * seguindo a cascata de FKs. Respeita ON DELETE SET NULL (não apaga a linha, só perde a ref).
 * Recusa ciclo ativo. Backup JSON antes.
 *   APP_ENV=dev npx tsx db/apaga-ciclos-teste.ts            # dry-run
 *   APP_ENV=dev npx tsx db/apaga-ciclos-teste.ts --commit
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import type { Consulta } from './sgu-sync.js';

const CICLOS = ['teste', 'teste_2', 'teste_3'];
class Simulacao extends Error {}
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function filhos(c: Consulta, tabela: string): Promise<{ tabela: string; coluna: string; acao: string }[]> {
  const { rows } = await c.query(
    `SELECT k.conrelid::regclass::text AS tabela, quote_ident(a.attname) AS coluna, k.confdeltype AS acao
       FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1] AND pa.attname = 'id'
      WHERE k.contype = 'f' AND k.confrelid = $1::regclass AND array_length(k.conkey, 1) = 1`, [tabela]);
  return rows;
}

// Apaga, de baixo para cima, a subárvore de teste e faz backup. Regra do SET NULL/DEFAULT ('n'/'d'):
// tabela eval_* é apagada mesmo assim (queremos a instância/resposta fora, não só o cycle_id nulo);
// tabela NÃO-eval_ com SET NULL é preservada (só perde a referência — ex.: um log).
const EVAL = /(^|\.)eval_/;
async function purgar(c: Consulta, tabela: string, ids: unknown[], backup: Record<string, any[]>,
  seen: Set<string>, nivel = 0) {
  if (!ids.length || nivel > 8) return;
  for (const f of await filhos(c, tabela)) {
    const { rows } = await c.query(`SELECT * FROM ${f.tabela} WHERE ${f.coluna} = ANY($1)`, [ids]);
    if (!rows.length) continue;
    (backup[f.tabela] ??= []).push(...rows);
    if ((f.acao === 'n' || f.acao === 'd') && !EVAL.test(f.tabela)) continue;
    const childIds = rows.map((r: any) => r.id).filter((x: any) => x != null && !seen.has(`${f.tabela}:${x}`));
    childIds.forEach((x: any) => seen.add(`${f.tabela}:${x}`));
    await purgar(c, f.tabela, childIds, backup, seen, nivel + 1);
    await c.query(`DELETE FROM ${f.tabela} WHERE ${f.coluna} = ANY($1)`, [ids]);
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    await withTransaction(async (c) => {
      const { rows: cycles } = await c.query(
        `SELECT id, label, active FROM eval_cycles WHERE label = ANY($1) ORDER BY id`, [CICLOS]);
      if (!cycles.length) { console.log('Nenhum ciclo de teste encontrado — nada a fazer.'); return; }
      const ativos = cycles.filter((c: any) => c.active);
      if (ativos.length) throw new Error(`Ciclo(s) ATIVO(S) na lista — abortado: ${ativos.map((c: any) => c.label).join(', ')}`);
      const cycleIds = cycles.map((c: any) => c.id);
      console.log(`Ciclos a apagar: ${cycles.map((c: any) => `${c.label}(#${c.id})`).join(', ')}`);

      const backup: Record<string, any[]> = { eval_cycles: cycles };
      const seen = new Set<string>();
      await purgar(c, 'eval_cycles', cycleIds, backup, seen);

      console.log('\nLinhas a apagar por tabela (cascata):');
      for (const [t, rows] of Object.entries(backup)) console.log(`   ${t}: ${rows.length}`);

      let arq = '';
      if (commit) {
        const dir = path.resolve(__dirname, '..', 'backups');
        fs.mkdirSync(dir, { recursive: true });
        arq = path.join(dir, `ciclos-teste-${process.env.APP_ENV ?? 'sem-env'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(arq, JSON.stringify(backup, null, 1));
        console.log(`Backup: ${arq}`);
      }
      const d = await c.query(`DELETE FROM eval_cycles WHERE id = ANY($1::bigint[])`, [cycleIds]);
      console.log(`\n✔ ${commit ? 'Apagados' : 'Simulados'}: ${d.rowCount} ciclos (o resto em cascata acima).`);
      if (!commit) throw new Simulacao();
    });
  } catch (e) {
    if (!(e instanceof Simulacao)) throw e;
    console.log('Dry-run: exclusões executadas e desfeitas (rollback) — nada apagado.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
