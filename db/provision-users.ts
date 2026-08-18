// Gera usuários de acesso para prestadores a partir do cadastro (tela Equipe→Usuários).
// 1 usuário por prestador sem usuário: nome/e-mail do cadastro, role por person_type
// (PF→cooperado, PJ→prestador), sem senha e SEM enviar convite — o convite é ação
// manual do admin no menu da tela. Prestador sem e-mail utilizável (ausente,
// inválido ou já em uso por outro usuário) TAMBÉM ganha usuário, com email NULL —
// aparece como "Sem e-mail" na tela até o admin definir um. Idempotente.
//
// Uso: [APP_ENV=dev] npm run db:provision-users [-- --commit]   (dry-run por padrão)
import 'dotenv/config';
import { query, pool } from './db.js';

const COMMIT = process.argv.includes('--commit');
const EMAIL_RE = String.raw`^[^@\s]+@[^@\s]+\.[^@\s]+$`;

async function main() {
  const url = new URL(process.env[`DATABASE_URL_${(process.env.APP_ENV || 'dev').toUpperCase()}`] || process.env.DATABASE_URL || '');
  console.log(`[provision-users] APP_ENV=${process.env.APP_ENV || '(vazio)'} host=${url.hostname}:${url.port} ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  const { rows: candidates } = await query(`
    SELECT p.id, p.name, p.person_type,
           (SELECT LOWER(TRIM(pl.email)) FROM provider_locations pl
             WHERE pl.provider_id = p.id AND pl.email ~ '${EMAIL_RE}'
             ORDER BY pl.id LIMIT 1) AS email
      FROM providers p
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.provider_id = p.id)
     ORDER BY p.id
  `);

  const { rows: used } = await query('SELECT LOWER(email) AS email FROM users');
  const taken = new Set(used.map((r: any) => r.email));

  const toCreate: any[] = [];
  const semEmail: any[] = [];
  const emailEmUso: any[] = [];
  for (const c of candidates) {
    if (!c.email) { semEmail.push(c); continue; }
    if (taken.has(c.email)) { emailEmUso.push(c); continue; }
    taken.add(c.email); // e-mail compartilhado entre prestadores: o primeiro leva
    toCreate.push(c);
  }

  // Sem e-mail utilizável (ausente ou já em uso) → cria mesmo assim, com email NULL.
  const semEmailUtilizavel = [...semEmail, ...emailEmUso];

  console.log(`[provision-users] prestadores sem usuário: ${candidates.length}`);
  console.log(`  → criar com e-mail: ${toCreate.length} (${toCreate.filter(c => c.person_type === 'PF').length} cooperado, ${toCreate.filter(c => c.person_type !== 'PF').length} prestador)`);
  console.log(`  → criar SEM e-mail (status "Sem e-mail" na tela): ${semEmailUtilizavel.length}`);
  console.log(`      sem e-mail válido no cadastro: ${semEmail.length}`);
  console.log(`      e-mail já em uso/compartilhado: ${emailEmUso.length}`);
  for (const c of emailEmUso.slice(0, 10)) console.log(`        ${c.id} ${c.name} <${c.email}>`);
  if (emailEmUso.length > 10) console.log(`        ... e mais ${emailEmUso.length - 10}`);

  if (!COMMIT) {
    console.log('[provision-users] dry-run: nada gravado. Use --commit para aplicar.');
    return;
  }

  let created = 0;
  const insert = async (c: any, email: string | null) => {
    try {
      await query(
        `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status)
         VALUES ($1, $2, NULL, $3, $4, true, 'pending')`,
        [c.name, email, c.person_type === 'PF' ? 'cooperado' : 'prestador', c.id]
      );
      created++;
    } catch (e: any) {
      if (e?.code === '23505') { console.warn(`  e-mail duplicado (corrida): ${email} — pulado`); return; }
      throw e;
    }
  };
  for (const c of toCreate) await insert(c, c.email);
  for (const c of semEmailUtilizavel) await insert(c, null);
  console.log(`[provision-users] concluído: ${created} usuários criados.`);
}

main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
