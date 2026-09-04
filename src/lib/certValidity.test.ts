import { test } from 'node:test';
import assert from 'node:assert/strict';
import { certValidUntilOk } from './certValidity.js';

test('aceita data igual ao fim do ciclo', () => {
  assert.equal(certValidUntilOk('2026-12-31', '2026-12-31'), true);
});
test('aceita data posterior ao fim', () => {
  assert.equal(certValidUntilOk('2027-12-31', '2026-12-31'), true);
});
test('rejeita data anterior ao fim', () => {
  assert.equal(certValidUntilOk('2026-11-30', '2026-12-31'), false);
});
test('ignora hora (compara só a data)', () => {
  assert.equal(certValidUntilOk('2027-01-01T00:00:00Z', '2026-12-31'), true);
});
