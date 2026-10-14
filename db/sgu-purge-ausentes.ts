/**
 * Limpeza ÚNICA (spec fase 2, A3; decisão da Katy em 14/10/2026): apaga os prestadores source='sgu'
 * que não estão na sgu_providers_raw, com os usuários deles. Backup JSON antes. Rodar depois do rekey.
 *   APP_ENV=dev npx tsx db/sgu-purge-ausentes.ts            # dry-run
 *   APP_ENV=dev npx tsx db/sgu-purge-ausentes.ts --commit
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import type { Consulta } from './sgu-sync.js';

const LIMITE = 0.20; // mais que isso do cadastro sgu = raw suspeita, aborta
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tabelas com FK de uma coluna para `tabela` — segue a cascata para o backup.
async function filhos(c: Consulta, tabela: string): Promise<{ tabela: string; coluna: string }[]> {
  const { rows } = await c.query(
    `SELECT k.conrelid::regclass::text AS tabela, a.attname AS coluna
       FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND k.confrelid = $1::regclass AND array_length(k.conkey, 1) = 1`, [tabela]);
  return rows;
}

async function coletar(c: Consulta, tabela: string, ids: unknown[], backup: Record<string, any[]>, nivel = 0) {
  if (!ids.length || nivel > 4) return;
  for (const f of await filhos(c, tabela)) {
    const { rows } = await c.query(`SELECT * FROM ${f.tabela} WHERE ${f.coluna} = ANY($1)`, [ids]);
    if (!rows.length) continue;
    (backup[f.tabela] ??= []).push(...rows);
    await coletar(c, f.tabela, rows.map((r) => r.id).filter((x) => x != null), backup, nivel + 1);
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    await withTransaction(async (c) => {
      const { rows: [{ n: nRaw }] } = await c.query(`SELECT count(*)::int AS n FROM sgu_providers_raw`);
      if (!nRaw) throw new Error('sgu_providers_raw vazia — nada é apagado.');
      const { rows: alvo } = await c.query(
        `SELECT p.id, p.sgu_code, p.name, p.status FROM providers p
          WHERE p.source = 'sgu'
            AND NOT EXISTS (SELECT 1 FROM sgu_providers_raw r WHERE r.codigo_prestador::text = p.sgu_code)
          ORDER BY p.sgu_code`);
      const { rows: [{ n: total }] } = await c.query(`SELECT count(*)::int AS n FROM providers WHERE source = 'sgu'`);
      if (alvo.length > LIMITE * total) {
        throw new Error(`${alvo.length} de ${total} prestadores seriam apagados (limite ${LIMITE * 100}%) — confira a raw.`);
      }
      const ids = alvo.map((r) => r.id);
      const backup: Record<string, any[]> = { providers: (await c.query(`SELECT * FROM providers WHERE id = ANY($1::bigint[])`, [ids])).rows };
      await coletar(c, 'providers', ids, backup);

      console.log(`Prestadores a apagar: ${alvo.length}`);
      for (const p of alvo) console.log(`   - ${p.sgu_code} ${p.name} (${p.status})`);
      console.log('Linhas que saem junto (backup):');
      for (const [t, rows] of Object.entries(backup)) console.log(`   ${t}: ${rows.length}`);
      if (!commit) { console.log('Dry-run: nada apagado. Para apagar: --commit'); return; }

      const dir = path.resolve(__dirname, '..', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const arq = path.join(dir, `sgu-purge-${process.env.APP_ENV ?? 'sem-env'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(arq, JSON.stringify(backup, null, 1));
      console.log(`Backup: ${arq}`);
      const u = await c.query(`DELETE FROM users WHERE provider_id = ANY($1::bigint[])`, [ids]);
      const p = await c.query(`DELETE FROM providers WHERE id = ANY($1::bigint[])`, [ids]);
      console.log(`✔ Apagados: ${p.rowCount} prestadores e ${u.rowCount} usuários (o resto em cascata).`);
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
