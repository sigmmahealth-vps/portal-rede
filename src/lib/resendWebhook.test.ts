import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyResendWebhook, resendEventToStatus } from './resendWebhook.js';

const secretRaw = crypto.randomBytes(24).toString('base64');
const secret = `whsec_${secretRaw}`;

function sign(id: string, ts: number, body: string): string {
  const sig = crypto.createHmac('sha256', Buffer.from(secretRaw, 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${sig}`;
}

test('assinatura válida passa', () => {
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const body = '{"type":"email.bounced","data":{"email_id":"abc"}}';
  const h = { id: 'msg_1', timestamp: String(ts), signature: sign('msg_1', ts, body) };
  assert.equal(verifyResendWebhook(secret, h, body, now), true);
});

test('corpo adulterado falha', () => {
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const h = { id: 'msg_1', timestamp: String(ts), signature: sign('msg_1', ts, 'original') };
  assert.equal(verifyResendWebhook(secret, h, 'adulterado', now), false);
});

test('timestamp velho falha (anti-replay)', () => {
  const now = Date.now();
  const ts = Math.floor(now / 1000) - 600; // 10 min atrás
  const body = 'x';
  const h = { id: 'm', timestamp: String(ts), signature: sign('m', ts, body) };
  assert.equal(verifyResendWebhook(secret, h, body, now), false);
});

test('headers ausentes falham', () => {
  assert.equal(verifyResendWebhook(secret, {}, 'x'), false);
  assert.equal(verifyResendWebhook('', { id: 'a', timestamp: '1', signature: 'v1,x' }, 'x'), false);
});

test('mapeamento de eventos', () => {
  assert.equal(resendEventToStatus('email.delivered'), 'entregue');
  assert.equal(resendEventToStatus('email.bounced'), 'rejeitado');
  assert.equal(resendEventToStatus('email.complained'), 'reclamado');
  assert.equal(resendEventToStatus('email.delivery_delayed'), null);
  assert.equal(resendEventToStatus(undefined), null);
});
