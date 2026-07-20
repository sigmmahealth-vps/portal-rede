import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeGreeting, welcomeLine } from './greeting.js';

const at = (h: number) => new Date(2026, 6, 20, h, 0, 0);

test('timeGreeting: manhã / tarde / noite', () => {
  assert.equal(timeGreeting(at(5)), 'Bom dia');
  assert.equal(timeGreeting(at(11)), 'Bom dia');
  assert.equal(timeGreeting(at(12)), 'Boa tarde');
  assert.equal(timeGreeting(at(17)), 'Boa tarde');
  assert.equal(timeGreeting(at(18)), 'Boa noite');
  assert.equal(timeGreeting(at(4)), 'Boa noite');
});

test('welcomeLine: 1º acesso vs retorno', () => {
  assert.equal(welcomeLine(null, at(9)), 'Bom dia, seja bem-vindo');
  assert.equal(welcomeLine(undefined, at(14)), 'Boa tarde, seja bem-vindo');
  assert.equal(welcomeLine('2026-07-19T10:00:00Z', at(20)), 'Boa noite, bem-vindo de volta');
});
