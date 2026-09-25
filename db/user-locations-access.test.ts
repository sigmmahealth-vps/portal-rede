// Fatia 4: providerUnits (server.ts) passou a casar o login via user_locations
// (não mais users.location_id). Sem harness de servidor no projeto, o teste
// exercita a MESMA query reescrita diretamente: unidade com vínculo em
// user_locations aparece com `user` preenchido; unidade sem vínculo fica
// `user = null` ("precisa responsável") — mesmo que users.location_id
// aponte pra ela (prova que a leitura não depende mais do escalar antigo).
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';

const TEST_SGU = '_TEST_ULA_';
const PROVIDER_ACCESS_ROLES = ['prestador', 'cooperado', 'credenciado', 'pf_nao_medico'];

// Cópia fiel da query reescrita em server.ts providerUnits (~1623).
async function providerUnits(providerId: number) {
  const { rows } = await query(
    `SELECT pl.id AS location_id, pl.label,
            u.id, u.name, u.email, u.role
       FROM provider_locations pl
       LEFT JOIN user_locations ul ON ul.location_id = pl.id
       LEFT JOIN users u ON u.id = ul.user_id AND u.role = ANY($2)
      WHERE pl.provider_id = $1
      ORDER BY pl.id`,
    [providerId, PROVIDER_ACCESS_ROLES]);
  return rows.map((r: any) => ({
    location_id: Number(r.location_id),
    label: r.label,
    user: r.id ? { id: Number(r.id), name: r.name, email: r.email, role: r.role } : null,
  }));
}

test('providerUnits casa o login via user_locations (não via users.location_id)', async () => {
  try {
    const { rows: [prov] } = await query(
      `INSERT INTO providers (sgu_code, name, status) VALUES ($1,$2,$3) RETURNING id`,
      [TEST_SGU, 'TESTE USER LOCATIONS', 'Ativo']);
    const providerId = Number(prov.id);

    const { rows: locs } = await query(
      `INSERT INTO provider_locations (provider_id, sgu_location_code, label, is_primary, in_medical_guide)
       VALUES ($1,'A','Unidade A',true,true), ($1,'B','Unidade B',false,true)
       RETURNING id, sgu_location_code`,
      [providerId]);
    const locA = Number(locs.find((l: any) => l.sgu_location_code === 'A').id);
    const locB = Number(locs.find((l: any) => l.sgu_location_code === 'B').id);

    // Login vinculado à unidade A via users.location_id (escalar antigo) MAS
    // sem linha em user_locations — não deve aparecer (prova que o escalar
    // sozinho não basta mais).
    const { rows: [userLegacy] } = await query(
      `INSERT INTO users (name, email, role, provider_id, location_id, is_active, invite_status)
       VALUES ('Legado', '_test_ula_legado@example.com', 'prestador', $1, $2, true, 'accepted')
       RETURNING id`,
      [providerId, locA]);

    let units = await providerUnits(providerId);
    assert.equal(units.find((u) => u.location_id === locA)?.user, null,
      'A sem vínculo em user_locations => user null, mesmo com users.location_id antigo apontando pra ela');
    assert.equal(units.find((u) => u.location_id === locB)?.user, null, 'B também sem vínculo => null');

    // Agora vincula esse mesmo login à unidade A via user_locations (o que a
    // criação de acesso passa a fazer no dual-write).
    await query(
      `INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1,$2,$3)`,
      [userLegacy.id, locA, providerId]);

    units = await providerUnits(providerId);
    assert.equal(units.find((u) => u.location_id === locA)?.user?.id, Number(userLegacy.id),
      'A com vínculo em user_locations => user preenchido');
    assert.equal(units.find((u) => u.location_id === locB)?.user, null, 'B continua sem vínculo => null');
  } finally {
    // users.provider_id é ON DELETE SET NULL (não cascateia), então o usuário de
    // teste sobrevive ao DELETE do provider — apaga por e-mail para o teste ser
    // re-executável (senão o próximo run colide na UNIQUE(email)).
    await query(`DELETE FROM users WHERE email = $1`, ['_test_ula_legado@example.com']);
    await query(`DELETE FROM providers WHERE sgu_code = $1`, [TEST_SGU]);
    await pool.end();
  }
});
