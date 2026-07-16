import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDevHost } from './import-tabela.js';

test('assertDevHost: aceita host de dev (reseau.proxy.rlwy.net)', () => {
  assert.doesNotThrow(() => assertDevHost('postgresql://u:p@reseau.proxy.rlwy.net:35128/db'));
});

test('assertDevHost: rejeita host que não é dev (ex.: homolog/prod)', () => {
  assert.throws(() => assertDevHost('postgresql://u:p@zephyr.proxy.rlwy.net:33616/db'));
});

test('assertDevHost: rejeita URL ausente', () => {
  // dotenv/config (importado por import-tabela.ts) já carregou .env real no
  // process.env deste dev machine; limpa as vars p/ testar o default sem ambiente.
  const keys = ['APP_ENV', 'DATABASE_URL', 'DATABASE_URL_DEV', 'DATABASE_URL_HOMOLOG', 'DATABASE_URL_PROD'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    assert.throws(() => assertDevHost(undefined));
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});
