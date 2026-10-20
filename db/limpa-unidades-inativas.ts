/**
 * Apaga unidades comerciais INATIVAS (endereço aposentado após relocação) que NÃO têm avaliação,
 * junto com o acesso órfão de cada uma (user vinculado só a unidade inativa). Mantém o prestador e
 * a unidade ativa. Backup JSON antes. Unidade inativa COM avaliação é pulada (nunca apaga histórico).
 *   APP_ENV=prod npx tsx db/limpa-unidades-inativas.ts            # dry-run
 *   APP_ENV=prod npx tsx db/limpa-unidades-inativas.ts --commit
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import type { Consulta } from './sgu-sync.js';
import { PROVIDER_ACCESS_ROLES } from './provider-role.js';

class Simulacao extends Error {}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMERCIAL = `COALESCE(l.label,'') NOT ILIKE 'residencial%' AND COALESCE(l.sgu_location_code,'') !~ '-RES$'`;

// FKs de uma coluna que apontam para `tabela`.id — para montar o backup em cascata.
async function filhos(c: Consulta, tabela: string): Promise<{ tabela: string; coluna: string }[]> {
  const { rows } = await c.query(
    `SELECT k.conrelid::regclass::text AS tabela, quote_ident(a.attname) AS coluna
       FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1] AND pa.attname = 'id'
      WHERE k.contype = 'f' AND k.confrelid = $1::regclass AND array_length(k.conkey, 1) = 1`, [tabela]);
  return rows;
}
async function backupFilhos(c: Consulta, tabela: string, ids: unknown[], backup: Record<string, any[]>) {
  if (!ids.length) return;
  for (const f of await filhos(c, tabela)) {
    const { rows } = await c.query(`SELECT * FROM ${f.tabela} WHERE ${f.coluna} = ANY($1)`, [ids]);
    if (rows.length) (backup[f.tabela] ??= []).push(...rows);
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    await withTransaction(async (c) => {
      // Unidades comerciais inativas, separando as que têm avaliação (puladas) das 0-aval (alvo).
      const { rows: inativas } = await c.query(
        `SELECT l.id, p.sgu_code, l.sgu_location_code AS loc, l.cidade, l.logradouro,
                (SELECT count(*)::int FROM eval_instances e WHERE e.location_id = l.id) AS evals
           FROM provider_locations l JOIN providers p ON p.id = l.provider_id
          WHERE NOT l.active AND ${COMERCIAL}
          ORDER BY p.sgu_code`);
      const alvo = inativas.filter((u: any) => u.evals === 0);
      const pulados = inativas.filter((u: any) => u.evals > 0);
      const unitIds = alvo.map((u: any) => u.id);

      // Acessos órfãos dessas unidades: user ligado a uma unidade-alvo e sem nenhuma unidade ativa.
      const { rows: orfaos } = unitIds.length ? await c.query(
        `SELECT DISTINCT u.id, u.email, p.sgu_code
           FROM users u JOIN providers p ON p.id = u.provider_id
          WHERE u.role = ANY($2)
            AND EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ANY($1::bigint[]))
            AND NOT EXISTS (SELECT 1 FROM user_locations ul JOIN provider_locations pl ON pl.id = ul.location_id
                             WHERE ul.user_id = u.id AND pl.active)
          ORDER BY u.id`, [unitIds, PROVIDER_ACCESS_ROLES]) : { rows: [] };
      const userIds = orfaos.map((u: any) => u.id);

      console.log(`\nUnidades inativas a apagar (0 avaliações): ${alvo.length}`);
      for (const u of alvo) console.log(`   - ${u.sgu_code} ${u.loc} ${u.logradouro} (${u.cidade})`);
      if (pulados.length) {
        console.log(`\nPuladas (têm avaliação, não apaga): ${pulados.length}`);
        for (const u of pulados) console.log(`   - ${u.sgu_code} ${u.loc} (${u.evals} aval.)`);
      }
      console.log(`\nAcessos órfãos a apagar: ${userIds.length}`);
      for (const u of orfaos) console.log(`   - user ${u.id} (${u.sgu_code}, ${u.email ?? 'sem e-mail'})`);
      if (!unitIds.length) { console.log('\nNada a fazer.'); return; }

      // Backup: unidades, users e todos os filhos de 1 nível (user_locations, logs, tokens, etc.).
      const backup: Record<string, any[]> = {
        provider_locations: (await c.query(`SELECT * FROM provider_locations WHERE id = ANY($1::bigint[])`, [unitIds])).rows,
        users: userIds.length ? (await c.query(`SELECT * FROM users WHERE id = ANY($1::bigint[])`, [userIds])).rows : [],
        // Vínculos explícitos (FK composto pode escapar do varredor de filhos).
        user_locations: (await c.query(
          `SELECT * FROM user_locations WHERE user_id = ANY($1::bigint[]) OR location_id = ANY($2::bigint[])`,
          [userIds, unitIds])).rows,
      };
      await backupFilhos(c, 'provider_locations', unitIds, backup);
      await backupFilhos(c, 'users', userIds, backup);
      console.log('\nLinhas no backup:');
      for (const [t, rows] of Object.entries(backup)) console.log(`   ${t}: ${rows.length}`);

      let arq = '';
      if (commit) {
        const dir = path.resolve(__dirname, '..', 'backups');
        fs.mkdirSync(dir, { recursive: true });
        arq = path.join(dir, `limpa-unidades-inativas-${process.env.APP_ENV ?? 'sem-env'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(arq, JSON.stringify(backup, null, 1));
        console.log(`Backup: ${arq}`);
      }

      // Vínculos primeiro (por user e por location), depois os users órfãos, depois as unidades.
      await c.query(`DELETE FROM user_locations WHERE user_id = ANY($1::bigint[]) OR location_id = ANY($2::bigint[])`, [userIds, unitIds]);
      if (userIds.length) await c.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [userIds]);
      const d = await c.query(`DELETE FROM provider_locations WHERE id = ANY($1::bigint[])`, [unitIds]);
      console.log(`\n✔ ${commit ? 'Apagadas' : 'Simuladas'}: ${d.rowCount} unidades e ${userIds.length} acessos órfãos.`);
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
