import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProviderRole } from './provider-role.js';

test('deriveProviderRole: PF/grupo → Função', () => {
  assert.equal(deriveProviderRole('PF', 'MEDICOS COOPERADOS'), 'cooperado');
  assert.equal(deriveProviderRole('PF', 'MEDICOS COOPERADOS ARARANGUA'), 'cooperado');
  assert.equal(deriveProviderRole('PF', 'MEDICOS CREDENCIADOS'), 'credenciado');
  assert.equal(deriveProviderRole('PF', ' medicos credenciados ararangua '), 'credenciado');
  assert.equal(deriveProviderRole('PF', 'PSICOLOGOS'), 'pf_nao_medico');
  assert.equal(deriveProviderRole('PF', null), 'pf_nao_medico');
  assert.equal(deriveProviderRole('PJ', 'MEDICOS COOPERADOS'), 'prestador');
  assert.equal(deriveProviderRole('PJ', 'MEDICOS CREDENCIADOS'), 'prestador');
  assert.equal(deriveProviderRole(null, 'PSICOLOGOS'), 'prestador');
});
