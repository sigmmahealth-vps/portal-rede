import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDeviceSecret, hashDeviceSecret, verifyDeviceSecret,
  deviceLabelFromUserAgent, isTrustedDeviceValid, TRUSTED_DEVICE_TTL_MS,
} from './trustedDevice.js';

test('generateDeviceSecret é opaco e de alta entropia (64 hex)', () => {
  const a = generateDeviceSecret();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, generateDeviceSecret());
});

test('hashDeviceSecret + verifyDeviceSecret casam e rejeitam o errado', () => {
  const secret = generateDeviceSecret();
  const hash = hashDeviceSecret(secret);
  assert.notEqual(hash, secret);
  assert.equal(verifyDeviceSecret(secret, hash), true);
  assert.equal(verifyDeviceSecret(generateDeviceSecret(), hash), false);
});

test('deviceLabelFromUserAgent extrai navegador/SO', () => {
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
  assert.equal(deviceLabelFromUserAgent(chromeWin), 'Chrome em Windows');
  assert.equal(deviceLabelFromUserAgent(undefined), 'Dispositivo desconhecido');
});

test('isTrustedDeviceValid exige não expirado e não revogado', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  const futuro = new Date(now.getTime() + 1000);
  assert.equal(isTrustedDeviceValid({ expiresAt: futuro, revokedAt: null }, now), true);
  assert.equal(isTrustedDeviceValid({ expiresAt: new Date(now.getTime() - 1), revokedAt: null }, now), false);
  assert.equal(isTrustedDeviceValid({ expiresAt: futuro, revokedAt: now }, now), false);
});

test('TTL é 90 dias', () => {
  assert.equal(TRUSTED_DEVICE_TTL_MS, 90 * 24 * 60 * 60 * 1000);
});
