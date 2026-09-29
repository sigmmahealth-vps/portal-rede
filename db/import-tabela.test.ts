import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReloadHost } from './import-tabela.js';

test('assertReloadHost: aceita host de dev (reseau.proxy.rlwy.net)', () => {
  assert.doesNotThrow(() => assertReloadHost('postgresql://u:p@reseau.proxy.rlwy.net:35128/db'));
});

test('assertReloadHost: aceita host de homolog (interchange.proxy.rlwy.net)', () => {
  assert.doesNotThrow(() => assertReloadHost('postgresql://u:p@interchange.proxy.rlwy.net:18205/db'));
});

test('assertReloadHost: rejeita host de prod (zephyr)', () => {
  assert.throws(() => assertReloadHost('postgresql://u:p@zephyr.proxy.rlwy.net:33616/db'));
});

test('assertReloadHost: prod só com --prod + APP_ENV=prod + URL = DATABASE_URL_PROD', () => {
  const PROD = 'postgresql://u:p@novo.proxy.rlwy.net:1/db';
  const saved = { a: process.env.APP_ENV, p: process.env.DATABASE_URL_PROD };
  process.env.APP_ENV = 'prod'; process.env.DATABASE_URL_PROD = PROD;
  try {
    assert.doesNotThrow(() => assertReloadHost(PROD, true));
    assert.throws(() => assertReloadHost(PROD, false));
    assert.throws(() => assertReloadHost('postgresql://u:p@outro.proxy.rlwy.net:2/db', true));
    process.env.APP_ENV = 'dev';
    assert.throws(() => assertReloadHost(PROD, true));
  } finally {
    for (const [k, v] of [['APP_ENV', saved.a], ['DATABASE_URL_PROD', saved.p]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('assertReloadHost: rejeita URL ausente', () => {
  // dotenv/config (importado por import-tabela.ts) já carregou .env real no
  // process.env deste dev machine; limpa as vars p/ testar o default sem ambiente.
  const keys = ['APP_ENV', 'DATABASE_URL', 'DATABASE_URL_DEV', 'DATABASE_URL_HOMOLOG', 'DATABASE_URL_PROD'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    assert.throws(() => assertReloadHost(undefined));
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});
