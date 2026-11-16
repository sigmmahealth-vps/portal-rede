import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obrigatoriosPara, type Requirement } from './matrizLegal.js';

const reqs: Requirement[] = [
  { type_id: 1, role: 'cooperado' },
  { type_id: 2, role: 'cooperado' },
  { type_id: 2, role: 'prestador' },
  { type_id: 3, role: 'prestador' },
];

test('retorna os type_id obrigatórios da função', () => {
  assert.deepEqual(obrigatoriosPara('cooperado', reqs), new Set([1, 2]));
  assert.deepEqual(obrigatoriosPara('prestador', reqs), new Set([2, 3]));
});

test('função sem obrigatórios → Set vazio', () => {
  assert.deepEqual(obrigatoriosPara('credenciado', reqs), new Set());
});

test('função desconhecida → Set vazio', () => {
  assert.deepEqual(obrigatoriosPara('inexistente', reqs), new Set());
});

test('lista vazia → Set vazio', () => {
  assert.deepEqual(obrigatoriosPara('cooperado', []), new Set());
});
