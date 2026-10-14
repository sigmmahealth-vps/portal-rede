// Grava a senha padrão da Unimed (SENHA_PADRAO_PRESTADOR) em TODOS os acessos de prestador, inclusive
// de quem já tinha trocado a senha (decisão da Katy, 14/10/2026), com troca obrigatória no próximo
// acesso e sessões encerradas (session_version + 1) — mesma regra do setUnitPassword do servidor.
// Equipe interna (admin/auditoria) não é tocada. Nunca imprime a senha.
//
// Uso: [APP_ENV=dev] npm run db:senha-padrao [-- --commit]   (dry-run por padrão)
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, pool } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { PROVIDER_ACCESS_ROLES } from './provider-role.js';

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  const senha = process.env.SENHA_PADRAO_PRESTADOR;
  if (!senha) throw new Error('SENHA_PADRAO_PRESTADOR não definida no ambiente.');

  const { rows: [n] } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE password IS NULL)::int AS sem_senha,
            count(*) FILTER (WHERE password IS NOT NULL AND NOT must_change_password)::int AS senha_propria
       FROM users WHERE role = ANY($1) AND provider_id IS NOT NULL`, [PROVIDER_ACCESS_ROLES]);
  console.log(`Acessos de prestador: ${n.total} (sem senha ${n.sem_senha}, com senha própria ${n.senha_propria}, `
    + `com provisória ${n.total - n.sem_senha - n.senha_propria})`);
  if (!commit) { console.log('Dry-run: nada gravado. Para aplicar: --commit'); return; }

  const r = await query(
    `UPDATE users SET password = $1, must_change_password = true, session_version = session_version + 1
      WHERE role = ANY($2) AND provider_id IS NOT NULL`,
    [await bcrypt.hash(senha, 10), PROVIDER_ACCESS_ROLES]);
  console.log(`✔ Senha padrão gravada em ${r.rowCount} acessos (troca obrigatória no próximo acesso).`);
}

main().then(() => pool.end()).catch(async (err) => { console.error(err.message ?? err); await pool.end(); process.exit(1); });
