// Reseta o banco DEV para um fixture mínimo de teste: apaga os dados de
// prestador/usuário e semeia 3 prestadores com endereço genérico (cada um com um
// acesso de prestador) + 1 acesso de administradora. Preserva o catálogo
// document_types (Parte 1), os roteiros/avaliações (definições) e o schema.
//
// DESTRUTIVO. NUNCA rode contra produção: a trava compara o alvo com DATABASE_URL_PROD.
// Senha de todos os acessos: ANONIMIZA_SENHA (mesma do .env).
//
// Uso: APP_ENV=dev npm run db:seed-teste            (dry-run)
//      APP_ENV=dev npm run db:seed-teste -- --commit
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, withTransaction, pool } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { assertNaoProducao } from './anonimiza-lib.js';
import { deriveProviderRole } from './provider-role.js';

const ADMIN_NOME = 'Katy Garcia';
const ADMIN_EMAIL = 'katy.garcia@sigmma.health';

// 3 prestadores de teste. CPF/CNPJ são valores de teste com dígitos verificadores
// válidos (caso o login valide). Endereço genérico igual, só muda o número.
const PRESTADORES = [
  { nome: 'Clínica Teste Alfa',       person_type: 'PJ', cnpj: '11222333000181', cpf: null,          group: 'CLINICAS',           sgu: 'TESTE-001', numero: '100', email: 'prestador.alfa@exemplo.invalid' },
  { nome: 'Dr. Teste Beta',           person_type: 'PF', cnpj: null,             cpf: '12345678909',  group: 'MEDICOS COOPERADOS', sgu: 'TESTE-002', numero: '200', email: 'prestador.beta@exemplo.invalid' },
  { nome: 'Laboratório Teste Gama',   person_type: 'PJ', cnpj: '11444777000161', cpf: null,          group: 'LABORATORIOS',       sgu: 'TESTE-003', numero: '300', email: 'prestador.gama@exemplo.invalid' },
];

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  assertNaoProducao(url, process.env.DATABASE_URL_PROD?.trim());
  const host = url ? new URL(url).host : '(vazio)';
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${host} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  const { rows: [antes] } = await query(
    `SELECT (SELECT count(*) FROM providers)::int AS prestadores,
            (SELECT count(*) FROM users)::int AS usuarios,
            (SELECT count(*) FROM documents)::int AS documentos`);
  console.log(`Será APAGADO (TRUNCATE providers CASCADE): ${antes.prestadores} prestadores, ${antes.usuarios} usuários, ${antes.documentos} documentos e tudo que depende deles.`);
  console.log(`Preservado: document_types (catálogo), roteiros/avaliações, settings, schema_migrations.`);
  console.log(`Será SEMEADO: 3 prestadores (${PRESTADORES.map(p => p.nome).join(', ')}), 1 acesso por prestador, e o admin ${ADMIN_EMAIL}.`);

  if (!commit) { console.log('Dry-run: nada gravado. Para aplicar: --commit'); return; }

  const senha = process.env.ANONIMIZA_SENHA;
  if (!senha) throw new Error('Defina ANONIMIZA_SENHA no .env (senha dos acessos de teste).');
  const hash = await bcrypt.hash(senha, 10);

  await withTransaction(async (client) => {
    // Apaga o grafo de prestador/usuário. CASCADE cobre unidades, contatos, acessos,
    // documentos, chamados, qualificação, avaliações, etc. document_types não referencia
    // providers → fica. RESTART IDENTITY reinicia os ids dos prestadores/unidades em 1.
    await client.query('TRUNCATE providers RESTART IDENTITY CASCADE');

    for (const p of PRESTADORES) {
      const { rows: [prov] } = await client.query(
        `INSERT INTO providers (sgu_code, name, person_type, cnpj, cpf, provider_group, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,'ativo','manual') RETURNING id`,
        [p.sgu, p.nome, p.person_type, p.cnpj, p.cpf, p.group]);

      const { rows: [loc] } = await client.query(
        `INSERT INTO provider_locations
           (provider_id, sgu_location_code, label, cep, logradouro, numero, bairro, cidade, uf, is_primary, in_medical_guide, active)
         VALUES ($1,$2,'Matriz','88800000','Rua Exemplo',$3,'Centro','Criciúma','SC',true,true,true) RETURNING id`,
        [prov.id, `${p.sgu}-01`, p.numero]);

      const role = deriveProviderRole(p.person_type, p.group);
      const { rows: [usr] } = await client.query(
        `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status, must_change_password, session_version)
         VALUES ($1,$2,$3,$4,$5,true,'accepted',false,1) RETURNING id`,
        [p.nome, p.email, hash, role, prov.id]);

      await client.query(
        `INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1,$2,$3)`,
        [usr.id, loc.id, prov.id]);

      console.log(`  + ${p.nome} (${role}, ${p.cnpj ?? p.cpf}) + acesso ${p.email}`);
    }

    await client.query(
      `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status, must_change_password, session_version)
       VALUES ($1,$2,$3,'admin',NULL,true,'accepted',false,1)`,
      [ADMIN_NOME, ADMIN_EMAIL.toLowerCase(), hash]);
    console.log(`  + admin ${ADMIN_EMAIL}`);

    const { rows: [v] } = await client.query(
      `SELECT (SELECT count(*) FROM providers)::int AS prov,
              (SELECT count(*) FROM provider_locations)::int AS loc,
              (SELECT count(*) FROM user_locations)::int AS vinc,
              (SELECT count(*) FROM users WHERE provider_id IS NOT NULL)::int AS prestadores,
              (SELECT count(*) FROM users WHERE role='admin')::int AS admins,
              (SELECT count(*) FROM document_types)::int AS tipos`);
    if (v.prov !== 3 || v.loc !== 3 || v.vinc !== 3 || v.prestadores !== 3 || v.admins !== 1 || v.tipos < 10) {
      throw new Error(`Verificação falhou: ${JSON.stringify(v)}`);
    }
    console.log(`  verificação OK: ${JSON.stringify(v)}`);
  });

  console.log('✔ Fixture de teste criado.');
}

main().then(() => pool.end()).catch(async (err) => { console.error(err.message ?? err); await pool.end(); process.exit(1); });
