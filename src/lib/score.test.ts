import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from './score.js';

const qs = [
  { id: 1, max_score: '10' }, // sim  -> 10
  { id: 2, max_score: '10' }, // nao  -> 0
  { id: 3, max_score: '10' }, // na   -> excluído (fora do denominador)
];

test('sim pontua, nao zera, N/A sai do denominador', () => {
  const r = computeScore(qs, {
    1: { answer_value: 'sim' },
    2: { answer_value: 'nao' },
    3: { answer_value: 'na' },
  });
  assert.equal(r.score, 10);
  assert.equal(r.maxPossible, 20); // 10 + 10, N/A não conta
  assert.equal(r.percentual, 50);
});

test('sem respostas e sem critérios aplicáveis -> percentual 0, sem divisão por zero', () => {
  assert.deepEqual(computeScore([], {}), { score: 0, maxPossible: 0, percentual: 0 });
  const allNa = computeScore([{ id: 1, max_score: '10' }], { 1: { answer_value: 'na' } });
  assert.deepEqual(allNa, { score: 0, maxPossible: 0, percentual: 0 });
});
