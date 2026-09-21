// Zera o módulo de Qualificação do banco de DEV ou HOMOLOG para recomeçar do zero: roteiros,
// ciclos, avaliações (selos), respostas, certificados, pesquisas, planos de ação,
// evidências e TODAS as notificações. Mantém prestadores, endereços, usuários,
// auth, settings, access_logs e as tabelas legadas qualification_* (decisão 21/09/2026).
//
// Só roda com APP_ENV=dev|homolog, em host liberado pelo assertReloadHost (prod é
// recusado), e só grava com --commit (dry-run por padrão). Antes de
// apagar, salva um backup JSON das tabelas afetadas em backups/.
// Depois de reimportar os roteiros, rode com --relink para religar
// providers.eval_script_id pelo roteiro_cod (FOR-XXX).
//
// Uso: [APP_ENV=homolog] npm run db:reset-qualificacao [-- --commit]
//      npm run db:reset-qualificacao -- --relink [--commit]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { query, pool, withTransaction } from './db.js';
import { assertReloadHost } from './import-tabela.js';

const COMMIT = process.argv.includes('--commit');
const RELINK = process.argv.includes('--relink');
// --keep-scripts: mantém os roteiros e suas marcações (usado no homolog, que tem
// roteiro sem .xlsx local para reimportar — FOR-025). Dispensa o --relink.
const KEEP_SCRIPTS = process.argv.includes('--keep-scripts');

// Ordem de DELETE respeita as FKs NO ACTION (planos antes de ciclos; ciclos antes de
// roteiros). O resto cai por CASCADE — listado aqui só para contagem e backup.
// Nunca TRUNCATE ... CASCADE: alcançaria users/providers (incidente do import-tabela).
const SCRIPT_TABLES = ['eval_questions', 'eval_sections', 'eval_scripts'];
const DELETE_ORDER = ['notifications', 'documents', 'eval_action_plans', 'eval_instances', 'eval_cycles', 'eval_scripts']
  .filter((t) => !(KEEP_SCRIPTS && t === 'eval_scripts'));
const AFFECTED = [
  'notifications', 'documents',
  'eval_action_events', 'eval_action_items', 'eval_action_plans',
  'eval_answer_iterations', 'eval_answers', 'eval_certificates', 'eval_survey_responses', 'eval_instances',
  'eval_cycle_groups', 'eval_cycle_overrides', 'eval_cycle_exclusions', 'eval_cycle_inclusions', 'eval_cycles',
  ...SCRIPT_TABLES,
].filter((t) => !(KEEP_SCRIPTS && SCRIPT_TABLES.includes(t)));
// access_logs fica de fora da checagem: o servidor de dev pode gravar nela durante a transação.
const KEPT = ['providers', 'provider_locations', 'users', 'user_locations', ...(KEEP_SCRIPTS ? SCRIPT_TABLES : [])];

async function counts(tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { rows: [r] } = await query(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = r.n;
  }
  return out;
}

// Roteiro vigente (maior revisão numérica) por código FOR-XXX extraído do source_file —
// mesma regra do db/import-providers.ts.
const RELINK_SQL = `
  WITH vigente AS (
    SELECT DISTINCT ON (cod) cod, id FROM (
      SELECT 'FOR-' || substring(source_file FROM 'FOR-(\\d+)') AS cod, id,
             COALESCE(NULLIF(regexp_replace(version, '\\D', '', 'g'), ''), '0')::int AS v
        FROM eval_scripts WHERE source_file ~ 'FOR-\\d+') s
     ORDER BY cod, v DESC, id DESC)
  UPDATE providers p SET eval_script_id = v.id
    FROM vigente v
   WHERE p.roteiro_cod = v.cod AND p.eval_script_id IS DISTINCT FROM v.id`;

async function relink() {
  const { rows: [antes] } = await query(
    `SELECT count(*) FILTER (WHERE eval_script_id IS NOT NULL)::int AS com,
            count(*) FILTER (WHERE eval_script_id IS NULL AND roteiro_cod IS NOT NULL)::int AS sem FROM providers`);
  console.log(`  prestadores com roteiro: ${antes.com}; sem roteiro mas com roteiro_cod: ${antes.sem}`);
  if (!COMMIT) { console.log('\n[reset-qualificacao] dry-run: nada gravado. Use --relink --commit para religar.'); return; }
  const { rowCount } = await query(RELINK_SQL);
  const { rows: faltando } = await query(
    `SELECT roteiro_cod, count(*)::int AS n FROM providers
      WHERE eval_script_id IS NULL AND roteiro_cod IS NOT NULL GROUP BY 1 ORDER BY 1`);
  console.log(`[reset-qualificacao] ${rowCount} prestadores religados.`);
  for (const f of faltando) console.log(`  ! sem roteiro importado para ${f.roteiro_cod}: ${f.n} prestadores`);
}

async function main() {
  const env = (process.env.APP_ENV || '').toLowerCase();
  const url = new URL(process.env[`DATABASE_URL_${env.toUpperCase()}`] || process.env.DATABASE_URL || '');
  console.log(`[reset-qualificacao] APP_ENV=${env || '(vazio)'} host=${url.hostname}:${url.port} ${RELINK ? 'RELINK ' : ''}${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  // Exige APP_ENV explícito E a URL do próprio ambiente (sem cair no fallback
  // DATABASE_URL, que aponta para produção); o host ainda passa pela trava compartilhada.
  if (!(env === 'dev' || env === 'homolog') || !process.env[`DATABASE_URL_${env.toUpperCase()}`]) {
    console.error('[reset-qualificacao] RECUSADO: só roda com APP_ENV=dev|homolog e DATABASE_URL_<ENV> definida.');
    process.exit(1);
  }
  assertReloadHost(url.toString());
  if (RELINK) return relink();

  const antes = await counts(AFFECTED);
  const mantidasAntes = await counts(KEPT);
  console.log('\n  a apagar:');
  for (const t of AFFECTED) console.log(`    ${t.padEnd(26)} ${antes[t]}`);
  console.log('\n  mantidas (não devem mudar):');
  for (const t of KEPT) console.log(`    ${t.padEnd(26)} ${mantidasAntes[t]}`);
  const { rows: [prov] } = await query(`SELECT count(*)::int AS n FROM providers WHERE eval_script_id IS NOT NULL`);
  if (KEEP_SCRIPTS) console.log(`\n  --keep-scripts: roteiros e marcações ficam; os ${prov.n} vínculos prestador→roteiro são preservados.`);
  else console.log(`\n  ${prov.n} prestadores perdem o vínculo com o roteiro (eval_script_id → NULL); roteiro_cod é preservado — religar com --relink após reimportar.`);

  if (!COMMIT) {
    console.log('\n[reset-qualificacao] dry-run: nada gravado. Use --commit para aplicar.');
    return;
  }

  // Backup JSON antes de apagar (pg_dump não existe nesta máquina).
  // ponytail: carrega cada tabela inteira em memória — ok para dezenas de milhares
  // de linhas; trocar por COPY/stream se a base de dev crescer muito.
  const dir = path.resolve('backups', `reset-qualificacao-${env}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const t of AFFECTED) {
    const { rows } = await query(`SELECT * FROM ${t}`);
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows));
  }
  const { rows: links } = await query(`SELECT id, eval_script_id, roteiro_cod FROM providers WHERE eval_script_id IS NOT NULL`);
  fs.writeFileSync(path.join(dir, 'providers_eval_script_id.json'), JSON.stringify(links));
  console.log(`\n[reset-qualificacao] backup gravado em ${dir}`);

  await withTransaction(async (client) => {
    for (const t of DELETE_ORDER) {
      const { rowCount } = await client.query(`DELETE FROM ${t}`);
      console.log(`[reset-qualificacao] ${t}: ${rowCount} apagadas`);
    }
    // Checagem dentro da transação: se sobrar algo ou o cadastro mudar, desfaz tudo.
    for (const t of AFFECTED) {
      const { rows: [r] } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
      if (r.n !== 0) throw new Error(`${t} ainda tem ${r.n} linhas — ROLLBACK`);
    }
    for (const t of KEPT) {
      const { rows: [r] } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
      if (r.n !== mantidasAntes[t]) throw new Error(`${t} mudou de ${mantidasAntes[t]} para ${r.n} — ROLLBACK`);
    }
  });

  if (KEEP_SCRIPTS) console.log('\n[reset-qualificacao] concluído (roteiros mantidos).');
  else console.log('\n[reset-qualificacao] concluído. Próximos passos: reimportar os roteiros, marcar os eliminatórios e rodar --relink --commit.');
}

main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
