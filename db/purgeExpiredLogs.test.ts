import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purgeExpiredLogs } from './purgeExpiredLogs.js';

function fakeDb() {
  const policies = [
    { action: '__login__', ttl_days: 180 },
    { action: 'password_reset_requested', ttl_days: 365 },
  ];
  const deleted: any[] = [];
  const query = async (sql: string, params: any[] = []) => {
    if (/FROM data_retention_policies/.test(sql)) return { rows: policies };
    if (/DELETE FROM access_logs/.test(sql)) {
      deleted.push({ sql, params });
      return { rowCount: /action IS NULL/.test(sql) ? 3 : 1, rows: [] };
    }
    if (/UPDATE settings/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  return { query, deleted };
}

test('purgeExpiredLogs aplica cada política e retorna totais', async () => {
  const db = fakeDb();
  const result = await purgeExpiredLogs(db.query);
  assert.equal(db.deleted.length, 2);
  assert.equal(result.totalDeleted, 4);
  assert.equal(result.deletedByAction['__login__'], 3);
  assert.equal(result.deletedByAction['password_reset_requested'], 1);
});

test('purgeExpiredLogs traduz __login__ para action IS NULL', async () => {
  const db = fakeDb();
  await purgeExpiredLogs(db.query);
  const loginCall = db.deleted.find(d => /action IS NULL/.test(d.sql));
  assert.ok(loginCall, 'esperava um DELETE com action IS NULL');
  assert.match(loginCall.sql, /action IS NULL/);
});
