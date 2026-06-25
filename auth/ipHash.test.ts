import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashIp } from './ipHash.js';

const SECRET = 'test-secret-32-bytes-min-aaaaaaaaaa';

test('IPv4: hash igual para mesmo /24', () => {
  const a = hashIp('189.45.12.1', SECRET);
  const b = hashIp('189.45.12.99', SECRET);
  assert.equal(a, b);
});

test('IPv4: hash diferente para /24 diferente', () => {
  const a = hashIp('189.45.12.1', SECRET);
  const b = hashIp('189.45.13.1', SECRET);
  assert.notEqual(a, b);
});

test('IPv6: hash igual para mesmo /48', () => {
  const a = hashIp('2804:14d:5cb0:abcd::1', SECRET);
  const b = hashIp('2804:14d:5cb0:ffff::ff', SECRET);
  assert.equal(a, b);
});

test('null/undefined/vazio retornam null', () => {
  assert.equal(hashIp(null, SECRET), null);
  assert.equal(hashIp(undefined, SECRET), null);
  assert.equal(hashIp('', SECRET), null);
});

test('secret vazio lança erro', () => {
  assert.throws(() => hashIp('1.2.3.4', ''), /IP_HASH_SECRET/);
});

test('formato inválido retorna null (não lança)', () => {
  assert.equal(hashIp('not-an-ip', SECRET), null);
});
