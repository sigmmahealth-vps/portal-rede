// Integração no banco de DEV — fora do npm test. Tudo numa transação desfeita no fim (ROLLBACK).
//   APP_ENV=dev node --import tsx --test db/sgu-sync.int.test.ts
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { executarPlano, suspenderERestaurar } from './sgu-sync.js';
import { planejarSync } from './sgu-sync-plan.js';
import { raw } from './sgu-test-fixtures.js';

after(() => pool.end());

test('sync em fixture: RT e e-mail de usuário preservados, unidade nova com acesso, suspende e restaura', async () => {
  assert.match(pickDatabaseUrl() ?? '', /reseau\.proxy\.rlwy\.net/, 'só roda no banco de dev');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const COD = '_TSYNC_1';
    const { rows: [p] } = await c.query(
      `INSERT INTO providers (sgu_code, name, person_type, status, responsavel_tecnico, source, specialties)
       VALUES ($1, 'FIXTURE SYNC', 'PF', 'ativo', 'DRA EDITADA NA TELA', 'sgu', '[]') RETURNING id`, [COD]);
    const { rows: [l] } = await c.query(
      `INSERT INTO provider_locations (provider_id, sgu_location_code, sgu_tipo_endereco, cep, logradouro, numero, active)
       VALUES ($1, $2, '2', '88801250', 'RUA CORONEL PEDRO BENEDET', '505', true) RETURNING id`, [p.id, `${COD}-2`]);
    const { rows: [u] } = await c.query(
      `INSERT INTO users (name, email, role, provider_id, is_active, invite_status)
       VALUES ('FIXTURE SYNC', 'editado@portal.test', 'cooperado', $1, true, 'accepted') RETURNING id`, [p.id]);
    await c.query(`INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1, $2, $3)`, [u.id, l.id, p.id]);
    await c.query(`UPDATE eval_cycles SET active = false WHERE active`);
    const { rows: [cy] } = await c.query(
      `INSERT INTO eval_cycles (label, start_date, end_date, active, cert_valid_until)
       VALUES ('_TSYNC', current_date, current_date + 30, true, current_date + 400) RETURNING id`);
    const { rows: [inst] } = await c.query(
      `INSERT INTO eval_instances (script_id, provider_id, location_id, status, cycle_id)
       VALUES ((SELECT id FROM eval_scripts ORDER BY id LIMIT 1), $1, $2, 'em_andamento', $3) RETURNING id`,
      [p.id, l.id, cy.id]);

    const unidade = { id: Number(l.id), sgu_location_code: `${COD}-2`, active: true };
    const afastado = [
      raw({ codigo_prestador: COD, status_prestador: 'AFASTADO', email_principal: 'cadastro@sgu.test' }),
      raw({ codigo_prestador: COD, status_prestador: 'AFASTADO', codigo_tipo_endereco: '3',
            logradouro: 'RUA NOVA', numero_endereco: '10', email_principal: 'Nova@SGU.test' }),
    ];
    await executarPlano(c, planejarSync(afastado, [{ id: Number(p.id), sgu_code: COD, status: 'ativo', locations: [unidade] }]), new Map());
    const s1 = await suspenderERestaurar(c);

    const { rows: [pp] } = await c.query(`SELECT status, responsavel_tecnico FROM providers WHERE id = $1`, [p.id]);
    assert.deepEqual({ ...pp }, { status: 'afastado', responsavel_tecnico: 'DRA EDITADA NA TELA' });
    const { rows: [uu] } = await c.query(`SELECT email, invite_status FROM users WHERE id = $1`, [u.id]);
    assert.deepEqual({ ...uu }, { email: 'editado@portal.test', invite_status: 'accepted' });
    const { rows: [l1] } = await c.query(`SELECT email FROM provider_locations WHERE id = $1`, [l.id]);
    assert.equal(l1.email, 'cadastro@sgu.test');
    const { rows: novas } = await c.query(
      `SELECT pl.sgu_location_code, u.email, u.password IS NULL AS sem_senha, u.invite_status
         FROM provider_locations pl JOIN user_locations ul ON ul.location_id = pl.id JOIN users u ON u.id = ul.user_id
        WHERE pl.provider_id = $1 AND pl.id <> $2`, [p.id, l.id]);
    assert.deepEqual(novas.map((r) => ({ ...r })),
      [{ sgu_location_code: `${COD}-3`, email: 'nova@sgu.test', sem_senha: true, invite_status: 'pending' }]);
    assert.equal(s1.suspensas, 1);
    const { rows: [i1] } = await c.query(`SELECT status, status_before_suspend FROM eval_instances WHERE id = $1`, [inst.id]);
    assert.deepEqual({ ...i1 }, { status: 'suspensa', status_before_suspend: 'em_andamento' });

    // Volta a ATIVO na carga seguinte: restaura o status anterior.
    await executarPlano(c, planejarSync([raw({ codigo_prestador: COD })],
      [{ id: Number(p.id), sgu_code: COD, status: 'afastado', locations: [unidade] }]), new Map());
    const s2 = await suspenderERestaurar(c);
    assert.equal(s2.restauradas, 1);
    const { rows: [i2] } = await c.query(`SELECT status, status_before_suspend FROM eval_instances WHERE id = $1`, [inst.id]);
    assert.deepEqual({ ...i2 }, { status: 'em_andamento', status_before_suspend: null });
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
