import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';
import { upsertProviderLocations } from './import-tabela.js';

test('upsert preserva provider_locations.id para a mesma chave SGU', async () => {
  const { rows: before } = await query(
    `SELECT id, sgu_location_code FROM provider_locations
      WHERE provider_id = (SELECT id FROM providers WHERE sgu_code = '1006724') ORDER BY id`, []);
  assert.ok(before.length > 0, 'pré-condição: provider 1006724 tem unidades');

  // Reaplica o mesmo conjunto (label alterado de propósito) e confere que o id fica.
  await upsertProviderLocations('1006724', before.map((r: any, i: number) => ({
    sgu_location_code: r.sgu_location_code, label: `RECHECK ${i}`, cidade: 'X', uf: 'SC',
    cep: null, logradouro: null, numero: null, complemento: null, bairro: null,
    phone: null, email: null, is_primary: i === 0, in_medical_guide: true,
  })));

  const { rows: after } = await query(
    `SELECT id, sgu_location_code, label FROM provider_locations
      WHERE provider_id = (SELECT id FROM providers WHERE sgu_code = '1006724') ORDER BY id`, []);
  assert.deepEqual(after.map((r: any) => r.id), before.map((r: any) => r.id), 'ids estáveis');
  assert.ok(after.every((r: any) => r.label.startsWith('RECHECK')), 'label atualizado (upsert, não insert)');
  await pool.end();
});
