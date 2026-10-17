/**
 * Limpeza ÚNICA (spec fase 2, A3; decisão da Katy em 14/10/2026): apaga os prestadores source='sgu'
 * que não estão na sgu_providers_raw, com os usuários deles. Backup JSON antes. Rodar depois do rekey.
 *   APP_ENV=dev npx tsx db/sgu-purge-ausentes.ts            # dry-run
 *   APP_ENV=dev npx tsx db/sgu-purge-ausentes.ts --commit
 * --intercambio (Katy, 17/10/2026): em vez dos ausentes, apaga os prestadores sgu que na raw são só
 * "07 - INTERCÂMBIO" (a rotina passou a ignorá-los) — recusa se algum já tiver avaliação ou login.
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import type { Consulta } from './sgu-sync.js';
import { TIPO_INTERCAMBIO } from './sgu-sync-plan.js';

const LIMITE = 0.20; // mais que isso do cadastro sgu = raw suspeita, aborta
class Simulacao extends Error {}
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tabelas com FK de uma coluna (para o id de `tabela`) — segue a cascata para o backup.
async function filhos(c: Consulta, tabela: string): Promise<{ tabela: string; coluna: string; acao: string }[]> {
  const { rows } = await c.query(
    `SELECT k.conrelid::regclass::text AS tabela, quote_ident(a.attname) AS coluna, k.confdeltype AS acao
       FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1] AND pa.attname = 'id'
      WHERE k.contype = 'f' AND k.confrelid = $1::regclass AND array_length(k.conkey, 1) = 1
      ORDER BY 1, 2`, [tabela]);
  return rows;
}

// Backup guarda todo filho (restore precisa dos SET NULL), deduplicado em `vistos`; só segue a cascata ('c')
// para os netos, e `seguidos` garante que toda linha alcançada por cascata é percorrida uma vez, mesmo que
// antes tenha entrado no backup por um FK SET NULL.
type PorTabela = Map<string, Set<string>>;
const doTabela = (m: PorTabela, t: string) => m.get(t) ?? m.set(t, new Set()).get(t)!;
async function coletar(c: Consulta, tabela: string, ids: unknown[], backup: Record<string, any[]>,
  vistos: PorTabela = new Map(), seguidos: PorTabela = new Map(), nivel = 0) {
  if (!ids.length || nivel > 4) return;
  for (const f of await filhos(c, tabela)) {
    const { rows } = await c.query(`SELECT * FROM ${f.tabela} WHERE ${f.coluna} = ANY($1)`, [ids]);
    const seen = doTabela(vistos, f.tabela);
    const novas = rows.filter((r) => r.id == null || (!seen.has(String(r.id)) && seen.add(String(r.id))));
    if (novas.length) (backup[f.tabela] ??= []).push(...novas);
    if (f.acao !== 'c') continue;
    const seg = doTabela(seguidos, f.tabela);
    const descer = rows.map((r) => r.id).filter((x) => x != null && !seg.has(String(x)));
    descer.forEach((x) => seg.add(String(x)));
    await coletar(c, f.tabela, descer, backup, vistos, seguidos, nivel + 1);
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const modoIntercambio = process.argv.includes('--intercambio');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`
    + (modoIntercambio ? ' | modo INTERCÂMBIO' : ''));
  try {
    await withTransaction(async (c) => {
      const { rows: [{ n: nRaw }] } = await c.query(`SELECT count(*)::int AS n FROM sgu_providers_raw`);
      if (!nRaw) throw new Error('sgu_providers_raw vazia — nada é apagado.');
      const { rows: alvo } = modoIntercambio
        ? await c.query(
          `SELECT p.id, p.sgu_code, p.name, p.status,
                  EXISTS (SELECT 1 FROM eval_instances i WHERE i.provider_id = p.id) AS tem_avaliacao,
                  EXISTS (SELECT 1 FROM users u WHERE u.provider_id = p.id AND u.last_login_at IS NOT NULL) AS tem_login
             FROM providers p
            WHERE p.source = 'sgu'
              AND EXISTS (SELECT 1 FROM sgu_providers_raw r WHERE r.codigo_prestador::text = p.sgu_code)
              AND NOT EXISTS (SELECT 1 FROM sgu_providers_raw r WHERE r.codigo_prestador::text = p.sgu_code
                                AND NOT (COALESCE(r.tipo_prestador, '') ~* $1))
            ORDER BY p.sgu_code`, [TIPO_INTERCAMBIO.source])
        : await c.query(
          `SELECT p.id, p.sgu_code, p.name, p.status FROM providers p
            WHERE p.source = 'sgu'
              AND NOT EXISTS (SELECT 1 FROM sgu_providers_raw r WHERE r.codigo_prestador::text = p.sgu_code)
            ORDER BY p.sgu_code`);
      const { rows: [{ n: total }] } = await c.query(`SELECT count(*)::int AS n FROM providers WHERE source = 'sgu'`);
      if (modoIntercambio) {
        // Sem trava de %: o alvo é definido pelo tipo na raw, não por ausência. Uso real não se apaga.
        const usados = alvo.filter((r) => r.tem_avaliacao || r.tem_login);
        if (usados.length) {
          throw new Error(`${usados.length} prestador(es) de intercâmbio já têm avaliação ou login — nada é apagado: `
            + usados.map((r) => r.sgu_code).join(', '));
        }
      } else if (alvo.length > LIMITE * total) {
        throw new Error(`${alvo.length} de ${total} prestadores seriam apagados (limite ${LIMITE * 100}%) — confira a raw.`);
      }
      const ids = alvo.map((r) => r.id);
      const backup: Record<string, any[]> = { providers: (await c.query(`SELECT * FROM providers WHERE id = ANY($1::bigint[])`, [ids])).rows };
      // Usuários saem explicitamente (provider_id é SET NULL): seus filhos em cascata também entram no backup.
      const userIds = (await c.query(`SELECT id FROM users WHERE provider_id = ANY($1::bigint[])`, [ids])).rows.map((r) => r.id);
      const vistos: PorTabela = new Map(), seguidos: PorTabela = new Map();
      await coletar(c, 'providers', ids, backup, vistos, seguidos);
      await coletar(c, 'users', userIds, backup, vistos, seguidos);

      console.log(`Prestadores a apagar: ${alvo.length}`);
      for (const p of alvo) console.log(`   - ${p.sgu_code} ${p.name} (${p.status})`);
      console.log('Linhas no backup (inclui vínculos que só perdem a referência):');
      for (const [t, rows] of Object.entries(backup)) console.log(`   ${t}: ${rows.length}`);
      let arq = '';
      if (commit) {
        const dir = path.resolve(__dirname, '..', 'backups');
        fs.mkdirSync(dir, { recursive: true });
        arq = path.join(dir, `sgu-purge-${modoIntercambio ? 'intercambio-' : ''}${process.env.APP_ENV ?? 'sem-env'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(arq, JSON.stringify(backup, null, 1));
        console.log(`Backup: ${arq}`);
      }
      // Usuários primeiro capturados: providers saem antes (levam planos/eventos em cascata, que apontam
      // para esses usuários sem ON DELETE) e só então os usuários — users.provider_id vira NULL no meio.
      let p, u;
      try {
        // Depois do DELETE de providers o provider_id some (NULL) e e-mails repetidos colidiriam em
        // users_staff_email_uniq (0057); o backup já guarda as linhas originais.
        await c.query(`UPDATE users SET email = NULL WHERE id = ANY($1::bigint[])`, [userIds]);
        p = await c.query(`DELETE FROM providers WHERE id = ANY($1::bigint[])`, [ids]);
        u = await c.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [userIds]);
      } catch (e) {
        console.error(commit ? `rollback — backup não usado: ${arq}` : 'rollback — a simulação falhou');
        throw e;
      }
      console.log(`✔ ${commit ? 'Apagados' : 'Simulados'}: ${p.rowCount} prestadores e ${u.rowCount} usuários (o resto em cascata).`);
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
