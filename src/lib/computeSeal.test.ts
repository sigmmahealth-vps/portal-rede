import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeal } from './computeSeal.js';

test('faixas exatas da spec 5.4.2.3', () => {
  assert.equal(computeSeal(100.00, false), 'Ouro');
  assert.equal(computeSeal(90.01, false),  'Ouro');
  assert.equal(computeSeal(90.00, false),  'Prata');
  assert.equal(computeSeal(60.01, false),  'Prata');
  assert.equal(computeSeal(60.00, false),  'Bronze');
  assert.equal(computeSeal(0.00,  false),  'Bronze');
});

test('eliminatório reprovado rebaixa a Bronze independente da nota', () => {
  assert.equal(computeSeal(95, true), 'Bronze');
  assert.equal(computeSeal(70, true), 'Bronze');
  assert.equal(computeSeal(30, true), 'Bronze');
});
