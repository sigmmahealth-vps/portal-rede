import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situacaoDocumento, contarSituacoes, conformidade, baldesAlvara, conformidadePorTipo } from './painelMetrics.js';

const hoje = new Date(2026, 10, 16); // 2026-11-16 local
const doc = (status: string, expiry: string | null, type = 'Alvará Sanitário') => ({ status, expiry_date: expiry, type });

test('situação por status/validade', () => {
  assert.equal(situacaoDocumento(doc('pendente', null), hoje), 'pendente');
  assert.equal(situacaoDocumento(doc('reprovado', null), hoje), 'irregular');
  assert.equal(situacaoDocumento(doc('valido', '2026-01-01'), hoje), 'irregular'); // vencido
  assert.equal(situacaoDocumento(doc('valido', null), hoje), 'regular');
  assert.equal(situacaoDocumento(doc('valido', '2027-06-30'), hoje), 'regular');   // > 30 dias
  assert.equal(situacaoDocumento(doc('valido', '2026-12-10'), hoje), 'vencendo');  // dentro de 30 dias
  assert.equal(situacaoDocumento(doc('valido', '2026-12-16'), hoje), 'vencendo');  // borda: exatamente +30 dias
  assert.equal(situacaoDocumento(doc('historico', null), hoje), 'historico');
});

test('contarSituacoes ignora histórico', () => {
  const c = contarSituacoes([doc('valido', null), doc('valido', '2026-01-01'), doc('pendente', null), doc('historico', null)], hoje);
  assert.deepEqual(c, { regular: 1, vencendo: 0, irregular: 1, pendente: 1, total: 3 });
});

test('conformidade: conforme/(conforme+irregular), sem pendentes', () => {
  assert.equal(conformidade([doc('valido', null), doc('valido', '2026-01-01'), doc('pendente', null)], hoje), 50);
  assert.equal(conformidade([doc('pendente', null)], hoje), 0); // denominador 0
});

test('baldesAlvara filtra por tipo', () => {
  const docs = [doc('valido', null, 'Alvará Sanitário'), doc('valido', '2026-01-01', 'Alvará Sanitário'), doc('valido', null, 'CNES')];
  assert.deepEqual(baldesAlvara(docs, 'Alvará Sanitário', hoje), { noPrazo: 1, aVencer: 0, vencido: 1 });
});

test('conformidadePorTipo', () => {
  const docs = [doc('valido', null, 'Alvará Sanitário'), doc('valido', '2026-01-01', 'Alvará Sanitário')];
  assert.deepEqual(conformidadePorTipo(docs, 'Alvará Sanitário', hoje), { conforme: 1, total: 2, pct: 50 });
});
