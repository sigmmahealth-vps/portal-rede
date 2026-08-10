// src/lib/certValidity.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValidUntil } from './certValidity.js';

test('validade = fim do ciclo + 1 ano (string date-only sem shift de timezone)', () => {
  assert.equal(computeValidUntil('2026-12-31', new Date(2026, 4, 25)), '2027-12-31');
});

test('sem ciclo cai no fallback (completed_at) + 1 ano', () => {
  assert.equal(computeValidUntil(null, new Date(2026, 4, 25)), '2027-05-25');
});

test('aceita Date vindo do driver pg', () => {
  assert.equal(computeValidUntil(new Date(2026, 11, 31), new Date(2026, 0, 1)), '2027-12-31');
});

test('29 de fevereiro vira 28 no ano seguinte', () => {
  assert.equal(computeValidUntil('2028-02-29', new Date(2026, 0, 1)), '2029-02-28');
});
