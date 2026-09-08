import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionConfig, isAbsoluteExpired, isRevoked } from './session.js';

const H = 60 * 60 * 1000;

test('parseSessionConfig: defaults 30 min de inatividade e 8 h de teto', () => {
  assert.deepEqual(parseSessionConfig({}), { idleMs: 30 * 60 * 1000, maxMs: 8 * H });
});

test('parseSessionConfig: lê SESSION_IDLE_MINUTES e SESSION_MAX_HOURS', () => {
  assert.deepEqual(
    parseSessionConfig({ SESSION_IDLE_MINUTES: '15', SESSION_MAX_HOURS: '4' }),
    { idleMs: 15 * 60 * 1000, maxMs: 4 * H },
  );
});

test('parseSessionConfig: valor inválido ou não positivo cai no default', () => {
  assert.deepEqual(
    parseSessionConfig({ SESSION_IDLE_MINUTES: 'abc', SESSION_MAX_HOURS: '0' }),
    { idleMs: 30 * 60 * 1000, maxMs: 8 * H },
  );
});

test('isAbsoluteExpired: dentro do teto não expira', () => {
  const start = Date.parse('2026-09-08T08:00:00Z');
  assert.equal(isAbsoluteExpired(start, new Date(start + 7 * H), 8 * H), false);
});

test('isAbsoluteExpired: exatamente no teto ainda vale', () => {
  const start = Date.parse('2026-09-08T08:00:00Z');
  assert.equal(isAbsoluteExpired(start, new Date(start + 8 * H), 8 * H), false);
});

test('isAbsoluteExpired: passado o teto expira', () => {
  const start = Date.parse('2026-09-08T08:00:00Z');
  assert.equal(isAbsoluteExpired(start, new Date(start + 8 * H + 1), 8 * H), true);
});

test('isAbsoluteExpired: início ausente ou inválido conta como expirado', () => {
  const now = new Date('2026-09-08T08:00:00Z');
  assert.equal(isAbsoluteExpired(undefined, now, 8 * H), true);
  assert.equal(isAbsoluteExpired(Number.NaN, now, 8 * H), true);
});

test('isRevoked: versão igual não está revogada', () => {
  assert.equal(isRevoked(3, 3), false);
});

test('isRevoked: versão diferente está revogada', () => {
  assert.equal(isRevoked(2, 3), true);
});

test('isRevoked: token sem versão (emitido antes da migration) está revogado', () => {
  assert.equal(isRevoked(undefined, 1), true);
  assert.equal(isRevoked('1', 1), true);
});
