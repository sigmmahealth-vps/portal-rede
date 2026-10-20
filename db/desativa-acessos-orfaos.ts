/**
 * Desativa acessos de prestador presos a unidade(s) INATIVA(S): o usuário está is_active=true mas
 * TODAS as unidades vinculadas a ele estão inativas (unidade aposentada após relocação/rekey).
 * Marca is_active=false e incrementa session_version (derruba sessão viva). Não apaga nada.
 *   APP_ENV=dev npx tsx db/desativa-acessos-orfaos.ts            # dry-run (só lista)
 *   APP_ENV=dev npx tsx db/desativa-acessos-orfaos.ts --commit   # aplica
 * Quem tem ao menos uma unidade ativa NÃO é tocado.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { query, pool } from './db.js';
import { PROVIDER_ACCESS_ROLES } from './provider-role.js';

const SELECT_ORFAOS = `
  SELECT u.id AS user_id, u.email, u.invite_status, p.sgu_code, p.name,
         string_agg(pl.sgu_location_code || ' (' || COALESCE(pl.cidade,'?') || ')', ', ' ORDER BY pl.id) AS unidades
    FROM users u
    JOIN providers p ON p.id = u.provider_id
    JOIN user_locations ul ON ul.user_id = u.id
    JOIN provider_locations pl ON pl.id = ul.location_id
   WHERE u.is_active = true AND u.role = ANY($1)
     AND NOT EXISTS (SELECT 1 FROM user_locations ul2 JOIN provider_locations pl2 ON pl2.id = ul2.location_id
                      WHERE ul2.user_id = u.id AND pl2.active)
   GROUP BY u.id, u.email, u.invite_status, p.sgu_code, p.name
   ORDER BY p.sgu_code`;

async function main() {
  const url = pickDatabaseUrl();
  const commit = process.argv.includes('--commit');
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'dry-run'}`);

  const { rows } = await query(SELECT_ORFAOS, [PROVIDER_ACCESS_ROLES]);
  console.log(`\nAcessos órfãos (só unidade inativa): ${rows.length}`);
  console.table(rows);
  if (!rows.length) return;

  if (!commit) { console.log('\n(dry-run — rode com --commit para desativar)'); return; }
  const ids = rows.map((r: any) => Number(r.user_id));
  const r = await query(
    `UPDATE users SET is_active = false, session_version = session_version + 1 WHERE id = ANY($1::bigint[])`, [ids]);
  console.log(`\n✔ Desativados: ${r.rowCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
}
