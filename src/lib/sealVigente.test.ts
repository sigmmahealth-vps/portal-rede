import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentCertificate } from './sealVigente.js';

test('currentCertificate: só certificado vigente dá selo; vale o emitido mais recente', () => {
  const hoje = '2026-09-24';
  assert.equal(currentCertificate([], hoje), null);
  assert.equal(currentCertificate([{ seal: 'Ouro', valid_until: '2026-09-23', issued_at: '2025-09-01' }], hoje), null, 'vencido');
  assert.equal(currentCertificate([{ seal: 'Ouro', valid_until: '2026-09-24', issued_at: '2025-09-01' }], hoje)?.seal, 'Ouro', 'vence hoje ainda vale');
  const r = currentCertificate([
    { seal: 'Bronze', valid_until: '2027-01-01', issued_at: '2026-01-10' },
    { seal: 'Prata', valid_until: '2027-06-01', issued_at: '2026-06-10' },
    { seal: 'Ouro', valid_until: '2026-01-01', issued_at: '2026-08-01' }, // vencido, mesmo sendo o mais novo
  ], hoje);
  assert.equal(r?.seal, 'Prata');
  assert.equal(currentCertificate([{ seal: null, valid_until: '2027-01-01' }], hoje), null, 'sem selo não conta');
});
