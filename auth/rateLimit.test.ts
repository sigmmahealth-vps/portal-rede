import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countWithinWindow, isRateLimited,
  PASSWORD_MAX_FAILURES, PASSWORD_WINDOW_MS,
} from './rateLimit.js';

test('countWithinWindow conta só dentro da janela', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  const dentro1 = new Date(now.getTime() - 1000);
  const dentro2 = new Date(now.getTime() - 60_000);
  const fora = new Date(now.getTime() - 16 * 60 * 1000);
  assert.equal(countWithinWindow([dentro1, dentro2, fora], now, 15 * 60 * 1000), 2);
});

test('isRateLimited dispara ao atingir o máximo', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  const ts = (m: number) => new Date(now.getTime() - m * 60_000);
  const quatro = [ts(1), ts(2), ts(3), ts(4)];
  assert.equal(isRateLimited(quatro, now, PASSWORD_WINDOW_MS, PASSWORD_MAX_FAILURES), false);
  assert.equal(isRateLimited([...quatro, ts(5)], now, PASSWORD_WINDOW_MS, PASSWORD_MAX_FAILURES), true);
});

test('constantes de senha', () => {
  assert.equal(PASSWORD_MAX_FAILURES, 5);
  assert.equal(PASSWORD_WINDOW_MS, 15 * 60 * 1000);
});
