// Limpeza total da base de usuários: apaga todo mundo fora da lista de contas
// operacionais preservadas e re-vincula o acesso de teste do prestador ao seu
// endereço. Depois rode `db:provision-users --commit` para recriar 1 usuário
// por par (prestador, endereço comercial).
//
// Só roda fora de produção e só grava com --commit (dry-run por padrão).
// Uso: [APP_ENV=dev] npm run db:reset-users [-- --commit]
import 'dotenv/config';
import { query, pool, withTransaction } from './db.js';

const COMMIT = process.argv.includes('--commit');

// Contas que sobrevivem (decisão 20/08/2026): admin de teste, auditor de teste
// — sem ele não há como testar o fluxo de análise — e a conta da equipe.
const KEEP = [
  'adm-homolog@hotmail.com',
  'prestador-homolog@hotmail.com',
  'auditoria-homolog@hotmail.com',
  'katy.garcia@sigmma.health',
];
const ADMIN_EMAIL = 'adm-homolog@hotmail.com';
// A conta admin nova nasce com a MESMA senha da conta de auditoria de teste —
// evita inventar (e vazar) uma senha nova no código.
const PASSWORD_TWIN = 'auditoria-homolog@hotmail.com';

async function main() {
  const env = (process.env.APP_ENV || '').toLowerCase();
  const url = new URL(process.env[`DATABASE_URL_${env.toUpperCase()}`] || process.env.DATABASE_URL || '');
  console.log(`[reset-users] APP_ENV=${env || '(vazio)'} host=${url.hostname}:${url.port} ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  if (env === 'prod' || env === 'production') {
    console.error('[reset-users] RECUSADO: este script não roda em produção.');
    process.exit(1);
  }

  const { rows: doomed } = await query(
    `SELECT id, name, email, role, provider_id FROM users
      WHERE email IS NULL OR LOWER(email) <> ALL($1::text[]) ORDER BY id`, [KEEP]);
  const { rows: kept } = await query(
    `SELECT id, email, role FROM users WHERE LOWER(email) = ANY($1::text[]) ORDER BY id`, [KEEP]);
  const ids = doomed.map((u: any) => Number(u.id));

  const { rows: [impacto] } = await query(`
    SELECT (SELECT COUNT(*) FROM eval_action_events WHERE actor_id = ANY($1::bigint[])) AS action_events,
           (SELECT COUNT(*) FROM eval_answer_iterations WHERE actor_id = ANY($1::bigint[])) AS iterations,
           (SELECT COUNT(*) FROM eval_instances WHERE auditor_id = ANY($1::bigint[])) AS instancias_auditadas,
           (SELECT COUNT(*) FROM access_logs WHERE user_id = ANY($1::bigint[])) AS access_logs,
           (SELECT COUNT(*) FROM notifications WHERE user_id = ANY($1::bigint[])) AS notificacoes
  `, [ids]);

  console.log(`\n  preservados (${kept.length}):`);
  for (const u of kept) console.log(`    ${u.id} ${u.email} [${u.role}]`);
  if (!kept.some((u: any) => u.email?.toLowerCase() === ADMIN_EMAIL)) {
    console.log(`    (criar) ${ADMIN_EMAIL} [admin] — senha copiada de ${PASSWORD_TWIN}`);
  }
  console.log(`\n  a apagar: ${doomed.length} usuários`);
  console.log(`  histórico afetado: ${impacto.action_events} eventos de plano e ${impacto.iterations} iterações ficam sem autor` +
              ` (nome do autor é preservado), ${impacto.instancias_auditadas} instâncias perdem o auditor,` +
              ` ${impacto.access_logs} access_logs e ${impacto.notificacoes} notificações ficam órfãos/apagados.`);

  if (!COMMIT) {
    console.log('\n[reset-users] dry-run: nada gravado. Use --commit para aplicar.');
    return;
  }

  await withTransaction(async (client) => {
    // FKs NO ACTION: soltar as referências antes do DELETE (o nome do autor fica,
    // é coluna denormalizada — a trilha continua legível).
    await client.query('UPDATE eval_action_events SET actor_id = NULL WHERE actor_id = ANY($1::bigint[])', [ids]);
    await client.query('UPDATE eval_action_plans SET created_by = NULL WHERE created_by = ANY($1::bigint[])', [ids]);
    await client.query('UPDATE eval_action_items SET validated_by = NULL WHERE validated_by = ANY($1::bigint[])', [ids]);
    await client.query('UPDATE password_setup_tokens SET created_by_user_id = NULL WHERE created_by_user_id = ANY($1::bigint[])', [ids]);
    const { rowCount } = await client.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [ids]);
    console.log(`[reset-users] ${rowCount} usuários apagados.`);

    // Admin de teste: cria com a senha da conta gêmea se ainda não existir.
    const { rowCount: adminCreated } = await client.query(`
      INSERT INTO users (name, email, password, role, is_active, invite_status)
      SELECT 'Admin Homolog', $1, password, 'admin', true, 'accepted' FROM users WHERE LOWER(email) = $2
       ON CONFLICT DO NOTHING`, [ADMIN_EMAIL, PASSWORD_TWIN]);
    console.log(adminCreated ? `[reset-users] ${ADMIN_EMAIL} criado.` : `[reset-users] ${ADMIN_EMAIL} já existia.`);

    // O acesso de teste do prestador passa a apontar para um endereço concreto.
    const { rows: relinked } = await client.query(`
      UPDATE users u SET location_id = (
        SELECT pl.id FROM provider_locations pl
         WHERE pl.provider_id = u.provider_id
           AND COALESCE(pl.label,'') NOT ILIKE 'residencial%'
           AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'
         ORDER BY pl.is_primary DESC NULLS LAST, pl.id LIMIT 1)
       WHERE u.provider_id IS NOT NULL AND u.location_id IS NULL
       RETURNING u.id, u.email, u.location_id`);
    for (const r of relinked) console.log(`[reset-users] ${r.email ?? r.id} vinculado ao endereço ${r.location_id}.`);
  });

  const { rows: [fim] } = await query(`SELECT COUNT(*) AS users, COUNT(location_id) AS com_endereco FROM users`, []);
  console.log(`[reset-users] restam ${fim.users} usuários (${fim.com_endereco} com endereço). Rode db:provision-users --commit para completar.`);
}

main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
