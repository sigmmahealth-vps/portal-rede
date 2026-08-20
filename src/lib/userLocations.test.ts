import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeFromUnits } from './userLocations.js';

test('sem unidades => fail-closed (vê nada)', () => {
  assert.deepEqual(scopeFromUnits([]), { seesNothing: true, ids: [] });
});
test('com unidades => escopo é o conjunto', () => {
  assert.deepEqual(scopeFromUnits([143, 144]), { seesNothing: false, ids: [143, 144] });
});
