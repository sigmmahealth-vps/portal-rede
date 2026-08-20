import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';
import { upsertProviderLocations } from './import-tabela.js';

const TEST_SGU = '_TEST_IDEMP_';

function loc(code: string, label: string, isPrimary: boolean) {
  return {
    sgu_location_code: code, label, cidade: 'X', uf: 'SC',
    cep: null, logradouro: null, numero: null, complemento: null, bairro: null,
    phone: null, email: null, is_primary: isPrimary, in_medical_guide: true,
  };
}

test('upsertProviderLocations: idempotência preserva id e desativa unidades removidas', async () => {
  try {
    await query(`INSERT INTO providers (sgu_code, name, status) VALUES ($1,$2,$3)`,
      [TEST_SGU, 'TESTE IDEMP', 'Ativo']);

    // Cria 2 unidades (A e B).
    await upsertProviderLocations(TEST_SGU, [
      loc('A', 'Unidade A', true),
      loc('B', 'Unidade B', false),
    ]);
    const { rows: created } = await query(
      `SELECT id, sgu_location_code FROM provider_locations
        WHERE provider_id = (SELECT id FROM providers WHERE sgu_code = $1) ORDER BY sgu_location_code`,
      [TEST_SGU]);
    assert.equal(created.length, 2, 'criou as 2 unidades');
    const idByCode = new Map(created.map((r: any) => [r.sgu_location_code, r.id]));

    // Caso idempotência: reaplica as mesmas 2 chaves (label alterado) — id deve ficar igual.
    await upsertProviderLocations(TEST_SGU, [
      loc('A', 'Unidade A RECHECK', true),
      loc('B', 'Unidade B RECHECK', false),
    ]);
    const { rows: afterUpsert } = await query(
      `SELECT id, sgu_location_code, label FROM provider_locations
        WHERE provider_id = (SELECT id FROM providers WHERE sgu_code = $1) ORDER BY sgu_location_code`,
      [TEST_SGU]);
    assert.equal(afterUpsert.length, 2, 'ainda 2 unidades (upsert, não insert)');
    for (const r of afterUpsert as any[]) {
      assert.equal(r.id, idByCode.get(r.sgu_location_code), `id estável para ${r.sgu_location_code}`);
      assert.ok(r.label.endsWith('RECHECK'), 'label atualizado');
    }

    // Caso desativação: reaplica só a loc A — B deve virar active=false, A continua active=true.
    await upsertProviderLocations(TEST_SGU, [loc('A', 'Unidade A', true)]);
    const { rows: afterDeactivate } = await query(
      `SELECT sgu_location_code, active FROM provider_locations
        WHERE provider_id = (SELECT id FROM providers WHERE sgu_code = $1) ORDER BY sgu_location_code`,
      [TEST_SGU]);
    const activeByCode = new Map((afterDeactivate as any[]).map((r) => [r.sgu_location_code, r.active]));
    assert.equal(activeByCode.get('A'), true, 'A permanece ativa');
    assert.equal(activeByCode.get('B'), false, 'B foi desativada (não apagada)');
  } finally {
    await query(`DELETE FROM providers WHERE sgu_code = $1`, [TEST_SGU]);
    await pool.end();
  }
});
