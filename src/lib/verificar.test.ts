import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusPorTipo, faltantesPara } from './verificar.js';

// hoje fixo (local): 2026-11-16
const hoje = new Date(2026, 10, 16);

test('statusPorTipo: aprovado vence os demais do mesmo tipo', () => {
  const m = statusPorTipo([
    { type_id: 1, status: 'reprovado', expiry_date: null, upload_date: '2026-02-01' },
    { type_id: 1, status: 'valido', expiry_date: '2027-01-01', upload_date: '2026-01-01' },
  ], hoje);
  assert.equal(m.get(1), 'aprovado');
});

test('statusPorTipo: sem aprovado, pega o status do mais recente', () => {
  const m = statusPorTipo([
    { type_id: 2, status: 'reprovado', expiry_date: null, upload_date: '2026-01-01' },
    { type_id: 2, status: 'pendente', expiry_date: null, upload_date: '2026-02-01' },
  ], hoje);
  assert.equal(m.get(2), 'pendente');
});

test('statusPorTipo: valido com validade passada vira vencido', () => {
  const m = statusPorTipo([
    { type_id: 3, status: 'valido', expiry_date: '2020-01-01', upload_date: '2019-01-01' },
  ], hoje);
  assert.equal(m.get(3), 'vencido');
});

test('statusPorTipo: ignora type_id nulo', () => {
  const m = statusPorTipo([
    { type_id: null, status: 'valido', expiry_date: null, upload_date: '2026-01-01' },
  ], hoje);
  assert.equal(m.size, 0);
});

test('faltantesPara: aprovado não é faltante; os demais com motivo; ausente quando não há doc', () => {
  const porTipo = new Map<number, any>([[1, 'aprovado'], [2, 'pendente'], [3, 'vencido']]);
  const f = faltantesPara([1, 2, 3, 4], porTipo);
  assert.deepEqual(f, [
    { type_id: 2, motivo: 'pendente' },
    { type_id: 3, motivo: 'vencido' },
    { type_id: 4, motivo: 'ausente' },
  ]);
});

test('faltantesPara: reprovado vira motivo reprovado', () => {
  const f = faltantesPara([5], new Map<number, any>([[5, 'reprovado']]));
  assert.deepEqual(f, [{ type_id: 5, motivo: 'reprovado' }]);
});
