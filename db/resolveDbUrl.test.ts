import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDatabaseUrl } from './resolveDbUrl.js';

test('escolhe DATABASE_URL_<APP_ENV> quando APP_ENV está definido', () => {
  assert.equal(
    pickDatabaseUrl({ APP_ENV: 'dev', DATABASE_URL_DEV: 'dev-url', DATABASE_URL: 'prod-url' }),
    'dev-url',
  );
});

test('APP_ENV é case-insensitive', () => {
  assert.equal(pickDatabaseUrl({ APP_ENV: 'DEV', DATABASE_URL_DEV: 'x' }), 'x');
});

test('cai para DATABASE_URL quando a var do ambiente está vazia (compat Railway)', () => {
  assert.equal(
    pickDatabaseUrl({ APP_ENV: 'prod', DATABASE_URL_PROD: '  ', DATABASE_URL: 'injected' }),
    'injected',
  );
});

test('sem APP_ENV usa DATABASE_URL puro', () => {
  assert.equal(pickDatabaseUrl({ DATABASE_URL: 'plain' }), 'plain');
});

test('retorna undefined quando nada está definido', () => {
  assert.equal(pickDatabaseUrl({}), undefined);
});
