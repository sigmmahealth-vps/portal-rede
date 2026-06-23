import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOtpCode, hashOtp, verifyOtp, isOtpExpired,
  OTP_TTL_MS, OTP_MAX_ATTEMPTS,
} from './otp.js';

test('generateOtpCode retorna 6 dígitos numéricos', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateOtpCode(), /^[0-9]{6}$/);
  }
});

test('hashOtp + verifyOtp casam e rejeitam o errado', () => {
  const hash = hashOtp('123456');
  assert.notEqual(hash, '123456');
  assert.equal(verifyOtp('123456', hash), true);
  assert.equal(verifyOtp('000000', hash), false);
});

test('isOtpExpired compara com expires_at', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  assert.equal(isOtpExpired(new Date(now.getTime() + 60_000), now), false);
  assert.equal(isOtpExpired(new Date(now.getTime() - 1), now), true);
});

test('constantes expostas', () => {
  assert.equal(OTP_TTL_MS, 10 * 60 * 1000);
  assert.equal(OTP_MAX_ATTEMPTS, 5);
});
