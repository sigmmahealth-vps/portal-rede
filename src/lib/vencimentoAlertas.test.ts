import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marcoVencimento, diasVencido, TETO_AVISOS_VENCIDO } from './vencimentoAlertas.js';

// hoje fixo (local): 2026-11-16
const hoje = new Date(2026, 10, 16);
const doc = (expiry_date: string | null) => ({ expiry_date });

test('diasVencido: dias locais inteiros de atraso (e negativo se futuro)', () => {
  assert.equal(diasVencido(doc('2026-11-15'), hoje), 1);
  assert.equal(diasVencido(doc('2026-11-01'), hoje), 15);
  assert.equal(diasVencido(doc('2026-11-16'), hoje), 0);
  assert.equal(diasVencido(doc('2026-11-20'), hoje), -4); // validade futura
});

test('sem validade → null', () => {
  assert.equal(marcoVencimento(doc(null), hoje), null);
});

test('vence em mais de 30 dias → null', () => {
  assert.equal(marcoVencimento(doc('2026-12-20'), hoje), null); // +34 dias
});

test('vence hoje → vencendo/aviso30 (borda inferior)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-11-16'), hoje), { tipo: 'vencendo', marco: 'aviso30' });
});

test('vence em 30 dias → vencendo (borda superior)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-12-16'), hoje), { tipo: 'vencendo', marco: 'aviso30' });
});

test('vence em 31 dias → null', () => {
  assert.equal(marcoVencimento(doc('2026-12-17'), hoje), null);
});

test('vencido há 0,1,2 dias → atraso:0', () => {
  assert.deepEqual(marcoVencimento(doc('2026-11-15'), hoje), { tipo: 'vencido', marco: 'atraso:0' }); // 1 dia
  assert.deepEqual(marcoVencimento(doc('2026-11-14'), hoje), { tipo: 'vencido', marco: 'atraso:0' }); // 2 dias
});

test('vencido há 3 dias → atraso:1', () => {
  assert.deepEqual(marcoVencimento(doc('2026-11-13'), hoje), { tipo: 'vencido', marco: 'atraso:1' }); // 3 dias
});

test('vencido há 27 dias → atraso:9 (último dentro do teto)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-10-20'), hoje), { tipo: 'vencido', marco: 'atraso:9' }); // 27 dias
});

test('vencido há 29 dias → atraso:9 (ainda dentro do teto)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-10-18'), hoje), { tipo: 'vencido', marco: 'atraso:9' }); // 29 dias
});

test('vencido há 30 dias → null (passou do teto)', () => {
  assert.equal(marcoVencimento(doc('2026-10-17'), hoje), null); // 30 dias → n=10 > 9
});

test('teto exportado é 10', () => {
  assert.equal(TETO_AVISOS_VENCIDO, 10);
});
