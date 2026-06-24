import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, hashToken, verifyToken, expirationFor, isExpired } from './setupToken.js';

test('generateToken produces 64 hex chars', () => {
  const t = generateToken();
  assert.equal(t.length, 64);
  assert.match(t, /^[0-9a-f]+$/);
});

test('generateToken produces unique tokens', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
  assert.equal(tokens.size, 100);
});

test('hashToken + verifyToken roundtrip', async () => {
  const plain = generateToken();
  const hash = await hashToken(plain);
  assert.notEqual(hash, plain);
  assert.equal(await verifyToken(plain, hash), true);
  assert.equal(await verifyToken('wrong', hash), false);
});

test('expirationFor(invite) returns 24h ahead', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const exp = expirationFor('invite', now);
  assert.equal(exp.getTime() - now.getTime(), 24 * 60 * 60 * 1000);
});

test('expirationFor(reset) returns 30min ahead', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const exp = expirationFor('reset', now);
  assert.equal(exp.getTime() - now.getTime(), 30 * 60 * 1000);
});

test('isExpired true when expires_at < now', () => {
  const past = new Date('2025-01-01T00:00:00Z');
  const now  = new Date('2026-01-01T00:00:00Z');
  assert.equal(isExpired(past, now), true);
});

test('isExpired false when expires_at > now', () => {
  const future = new Date('2027-01-01T00:00:00Z');
  const now    = new Date('2026-01-01T00:00:00Z');
  assert.equal(isExpired(future, now), false);
});
