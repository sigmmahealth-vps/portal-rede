import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from './passwordPolicy.js';

test('senha forte válida (>=10 chars + Aa + 1 + símbolo)', () => {
  const r = validatePassword('Unimed2026!');
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('senha curta (< 10 chars)', () => {
  const r = validatePassword('Abc1!xx');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('10')));
});

test('senha sem maiúscula', () => {
  const r = validatePassword('unimed2026!');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('maiúscula') || e.toLowerCase().includes('maiuscula')));
});

test('senha sem minúscula', () => {
  const r = validatePassword('UNIMED2026!');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('minúscula') || e.toLowerCase().includes('minuscula')));
});

test('senha sem número', () => {
  const r = validatePassword('UnimedAbcde!');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('número') || e.toLowerCase().includes('numero')));
});

test('senha sem símbolo', () => {
  const r = validatePassword('Unimed20266');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('símbolo') || e.toLowerCase().includes('simbolo')));
});

test('senha vazia falha em todos os critérios', () => {
  const r = validatePassword('');
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 4);
});

test('senha com acentos conta como letra', () => {
  const r = validatePassword('Çriciuma2026!');
  assert.equal(r.ok, true);
});

test('símbolos variados aceitos', () => {
  for (const sym of ['@', '#', '$', '%', '&', '*', '?']) {
    const r = validatePassword(`Unimed2026${sym}`);
    assert.equal(r.ok, true, `símbolo ${sym} deveria passar`);
  }
});
