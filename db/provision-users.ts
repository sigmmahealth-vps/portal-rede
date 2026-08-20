// Gera usuários de acesso a partir do cadastro (tela Equipe→Usuários).
// 1 usuário por par (prestador, ENDEREÇO comercial) sem usuário: nome do
// prestador, e-mail do próprio endereço, role por person_type (PF→cooperado,
// PJ→prestador), sem senha e SEM enviar convite — o convite é ação manual do
// admin no menu da tela. Endereço sem e-mail utilizável (ausente, inválido ou
// já em uso por outro usuário) TAMBÉM ganha usuário, com email NULL — aparece
// como "Sem e-mail" na tela até o admin definir um. Idempotente.
//
// Uso: [APP_ENV=dev] npm run db:provision-users [-- --commit]   (dry-run por padrão)
import 'dotenv/config';
import { query, pool } from './db.js';

const COMMIT = process.argv.includes('--commit');
const EMAIL_RE = String.raw`^[^@\s]+@[^@\s]+\.[^@\s]+$`;

// Mesmo filtro comercial do /api/me/provider e do dashboard: residencial não avalia.
const COMERCIAL = `COALESCE(pl.label,'') NOT ILIKE 'residencial%'
                   AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'`;

async function main() {
  const url = new URL(process.env[`DATABASE_URL_${(process.env.APP_ENV || 'dev').toUpperCase()}`] || process.env.DATABASE_URL || '');
  console.log(`[provision-users] APP_ENV=${process.env.APP_ENV || '(vazio)'} host=${url.hostname}:${url.port} ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  const { rows: candidates } = await query(`
    SELECT pl.id AS location_id, pl.provider_id, pl.label, pl.cidade,
           p.name, p.person_type,
           CASE WHEN LOWER(TRIM(pl.email)) ~ '${EMAIL_RE}' THEN LOWER(TRIM(pl.email)) END AS email
      FROM provider_locations pl
      JOIN providers p ON p.id = pl.provider_id
     WHERE ${COMERCIAL}
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.location_id = pl.id)
     ORDER BY pl.provider_id, pl.id
  `);

  const { rows: used } = await query('SELECT LOWER(email) AS email FROM users WHERE email IS NOT NULL');
  const taken = new Set(used.map((r: any) => r.email));

  const toCreate: any[] = [];
  const semEmail: any[] = [];
  const emailEmUso: any[] = [];
  for (const c of candidates) {
    if (!c.email) { semEmail.push(c); continue; }
    if (taken.has(c.email)) { emailEmUso.push(c); continue; }
    taken.add(c.email); // e-mail repetido entre unidades: a primeira leva
    toCreate.push(c);
  }
  const semEmailUtilizavel = [...semEmail, ...emailEmUso];

  console.log(`[provision-users] endereços comerciais sem usuário: ${candidates.length}`);
  console.log(`  → criar com e-mail: ${toCreate.length} (${toCreate.filter(c => c.person_type === 'PF').length} cooperado, ${toCreate.filter(c => c.person_type !== 'PF').length} prestador)`);
  console.log(`  → criar SEM e-mail (status "Sem e-mail" na tela): ${semEmailUtilizavel.length}`);
  console.log(`      sem e-mail válido no endereço: ${semEmail.length}`);
  console.log(`      e-mail já em uso/compartilhado: ${emailEmUso.length}`);
  for (const c of emailEmUso.slice(0, 10)) console.log(`        loc ${c.location_id} ${c.name} <${c.email}>`);
  if (emailEmUso.length > 10) console.log(`        ... e mais ${emailEmUso.length - 10}`);

  if (!COMMIT) {
    console.log('[provision-users] dry-run: nada gravado. Use --commit para aplicar.');
    return;
  }

  let created = 0;
  const insert = async (c: any, email: string | null) => {
    try {
      await query(
        `INSERT INTO users (name, email, password, role, provider_id, location_id, is_active, invite_status)
         VALUES ($1, $2, NULL, $3, $4, $5, true, 'pending')`,
        [c.name, email, c.person_type === 'PF' ? 'cooperado' : 'prestador', c.provider_id, c.location_id]
      );
      created++;
    } catch (e: any) {
      if (e?.code === '23505') { console.warn(`  duplicado (corrida): loc ${c.location_id} ${email ?? '(sem e-mail)'} — pulado`); return; }
      throw e;
    }
  };
  for (const c of toCreate) await insert(c, c.email);
  for (const c of semEmailUtilizavel) await insert(c, null);
  console.log(`[provision-users] concluído: ${created} usuários criados.`);
}

main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
