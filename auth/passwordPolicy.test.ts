import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from './passwordPolicy.js';

test('valid password (8+ chars, letter, digit)', () => {
  const r = validatePassword('senha1234');
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('too short (< 8)', () => {
  const r = validatePassword('senha12');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('8')));
});

test('only digits', () => {
  const r = validatePassword('12345678');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('letra')));
});

test('only letters', () => {
  const r = validatePassword('apenasletras');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('número') || e.toLowerCase().includes('numero')));
});

test('empty string', () => {
  const r = validatePassword('');
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
});

test('with spaces is allowed (counts as char, not letter/digit)', () => {
  const r = validatePassword('a1      ');
  assert.equal(r.ok, true);
});

test('unicode letters count', () => {
  const r = validatePassword('senhação1');
  assert.equal(r.ok, true);
});
