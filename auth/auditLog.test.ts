import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLog } from './auditLog.js';

test('auditLog insere com sucesso na primeira tentativa', async () => {
  const calls: any[] = [];
  const query = async (sql: string, params: any[]) => {
    calls.push({ sql, params });
    return { rows: [] };
  };
  await auditLog({
    query,
    userId: 42, email: 'x@y.com', action: 'login',
    meta: { foo: 'bar' }, ip: '10.0.0.1', success: true,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO access_logs/);
  assert.equal(calls[0].params[0], 42);
  assert.equal(calls[0].params[1], 'x@y.com');
  assert.equal(calls[0].params[2], 'login');
  assert.equal(calls[0].params[3], JSON.stringify({ foo: 'bar' }));
  assert.equal(calls[0].params[4], '10.0.0.1');
  assert.equal(calls[0].params[5], true);
});

test('auditLog tenta 3x antes de chamar o alerta', async () => {
  let attempts = 0;
  const alerts: string[] = [];
  const query = async () => { attempts++; throw new Error('db down'); };
  await auditLog({
    query, alert: (msg) => { alerts.push(msg); },
    userId: 1, action: 'login', success: false,
  });
  assert.equal(attempts, 3);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /\[AUDIT-FAIL\]/);
});

test('auditLog aceita campos opcionais como null/undefined', async () => {
  const calls: any[] = [];
  const query = async (_sql: string, params: any[]) => { calls.push(params); return { rows: [] }; };
  await auditLog({ query, action: 'password_set', success: true });
  assert.equal(calls[0][0], null);  // userId
  assert.equal(calls[0][1], null);  // email
  assert.equal(calls[0][3], null);  // meta JSON
  assert.equal(calls[0][4], null);  // ip
});
