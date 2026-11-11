// Anonimiza (LGPD) uma CÓPIA de produção já restaurada num banco dev/homolog.
// Scrub nas tabelas estruturais + truncate nas operacionais/log. Idempotente.
// NUNCA rode contra produção: a trava compara o alvo com DATABASE_URL_PROD.
//
// Fluxo: pg_dump prod → restaura no banco novo → aponte APP_ENV p/ esse banco →
//   APP_ENV=dev npm run db:anonimiza            (dry-run: só conta)
//   APP_ENV=dev npm run db:anonimiza -- --commit
//
// Senha dev de TODOS os usuários: ANONIMIZA_SENHA (ou SENHA_PADRAO_PRESTADOR).
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, withTransaction, pool } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { TABELAS_TRUNCAR, assertNaoProducao } from './anonimiza-lib.js';

// Mesmas fórmulas de anonimiza-lib (testadas lá), em SQL set-based para não
// puxar N linhas ao cliente. Mantenha as duas em sincronia se mudar o formato.
const SCRUB: Array<{ nome: string; sql: string }> = [
  {
    nome: 'providers',
    sql: `UPDATE providers SET
            name = 'Prestador ' || id,
            trade_name = CASE WHEN trade_name IS NULL THEN NULL ELSE 'Fantasia ' || id END,
            cnpj = CASE WHEN cnpj IS NULL THEN NULL ELSE left((90000000000000 + id)::text, 14) END,
            cpf  = CASE WHEN cpf  IS NULL THEN NULL ELSE left((90000000000 + id)::text, 11) END,
            council_registry = CASE WHEN council_registry IS NULL THEN NULL ELSE 'CRM-SC ' || lpad((id % 100000)::text, 5, '0') END,
            responsavel_tecnico = CASE WHEN responsavel_tecnico IS NULL THEN NULL ELSE 'Resp Tecnico ' || id END`,
  },
  {
    nome: 'provider_locations',
    sql: `UPDATE provider_locations SET
            cep = '88' || lpad((id % 1000000)::text, 6, '0'),
            logradouro = 'Rua Teste',
            numero = (id % 1000)::text,
            complemento = NULL,
            bairro = 'Centro',
            phone = CASE WHEN phone IS NULL THEN NULL ELSE '4790000' || lpad((id % 10000)::text, 4, '0') END`,
  },
  {
    nome: 'provider_contacts',
    sql: `UPDATE provider_contacts SET
            name = 'Pessoa ' || id,
            email = CASE WHEN email IS NULL THEN NULL ELSE 'c' || id || '@exemplo.invalid' END,
            phone = CASE WHEN phone IS NULL THEN NULL ELSE '4790000' || lpad((id % 10000)::text, 4, '0') END,
            cpf = CASE WHEN cpf IS NULL THEN NULL ELSE left((90000000000 + id)::text, 11) END,
            council_registry = CASE WHEN council_registry IS NULL THEN NULL ELSE 'CRM-SC ' || lpad((id % 100000)::text, 5, '0') END`,
  },
  {
    // documents: arquivos não são copiados → referência quebra. Mantém a linha
    // (p/ testar o módulo), zera o apontador e o motivo de reprova (texto livre).
    nome: 'documents',
    sql: `UPDATE documents SET file_url = NULL, rejection_reason = NULL`,
  },
];

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  assertNaoProducao(url, process.env.DATABASE_URL_PROD?.trim());
  const host = url ? new URL(url).host : '(vazio)';
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${host} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  const { rows: [c] } = await query(
    `SELECT (SELECT count(*) FROM providers)::int AS providers,
            (SELECT count(*) FROM provider_locations)::int AS locations,
            (SELECT count(*) FROM provider_contacts)::int AS contacts,
            (SELECT count(*) FROM users)::int AS users,
            (SELECT count(*) FROM documents)::int AS documents`);
  console.log(`Alvo: ${c.providers} prestadores, ${c.locations} locais, ${c.contacts} contatos, ${c.users} usuários, ${c.documents} documentos.`);
  console.log(`Truncar (zerar): ${TABELAS_TRUNCAR.join(', ')}.`);

  if (!commit) { console.log('Dry-run: nada gravado. Para aplicar: --commit'); return; }

  const senha = process.env.ANONIMIZA_SENHA || process.env.SENHA_PADRAO_PRESTADOR;
  if (!senha) throw new Error('Defina ANONIMIZA_SENHA (ou SENHA_PADRAO_PRESTADOR) com a senha dev dos usuários.');
  const hash = await bcrypt.hash(senha, 10);

  await withTransaction(async (client) => {
    for (const { nome, sql } of SCRUB) {
      const r = await client.query(sql);
      console.log(`  scrub ${nome}: ${r.rowCount} linhas`);
    }
    // Usuários: nome/e-mail sintéticos, senha dev conhecida, IP fora, sessões mortas.
    const u = await client.query(
      `UPDATE users SET
         name = 'Pessoa ' || id,
         email = 'u' || id || '@exemplo.invalid',
         password = $1,
         must_change_password = false,
         last_login_ip = NULL,
         session_version = session_version + 1`,
      [hash]);
    console.log(`  scrub users: ${u.rowCount} linhas`);

    // CASCADE: também zera tabelas com FK para estas. São tabelas-folha de log;
    // ponytail: se um dia algo que você QUER manter referenciar uma delas, liste
    // a filha aqui em vez de confiar no CASCADE.
    await client.query(`TRUNCATE ${TABELAS_TRUNCAR.join(', ')} RESTART IDENTITY CASCADE`);
    console.log(`  truncate: ${TABELAS_TRUNCAR.length} tabelas`);

    // Verificação: qualquer PII real que sobrar aborta (rollback).
    const { rows: [v] } = await client.query(
      `SELECT (SELECT count(*) FROM users WHERE email NOT LIKE '%@exemplo.invalid')::int AS u_email,
              (SELECT count(*) FROM provider_contacts WHERE email IS NOT NULL AND email NOT LIKE '%@exemplo.invalid')::int AS c_email,
              (SELECT count(*) FROM providers WHERE cnpj IS NOT NULL AND left(cnpj,1) <> '9')::int AS p_cnpj,
              (SELECT count(*) FROM providers WHERE cpf  IS NOT NULL AND left(cpf,1)  <> '9')::int AS p_cpf,
              (SELECT count(*) FROM documents WHERE file_url IS NOT NULL)::int AS d_file`);
    const leaks = Object.entries(v).filter(([, n]) => Number(n) > 0);
    if (leaks.length) {
      throw new Error(`Verificação falhou (PII remanescente): ${leaks.map(([k, n]) => `${k}=${n}`).join(', ')}`);
    }
    console.log('  verificação: OK (nenhum e-mail/doc real remanescente).');
  });

  console.log('✔ Anonimização concluída.');
}

main().then(() => pool.end()).catch(async (err) => { console.error(err.message ?? err); await pool.end(); process.exit(1); });
