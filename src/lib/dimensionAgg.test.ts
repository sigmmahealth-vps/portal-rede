import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSecurityDL, type DimTotals } from './dimensionAgg.js';

test('mergeSecurityDL soma DL na Segurança (score e max_possible)', () => {
  const r = mergeSecurityDL([
    { dimension: 'Segurança',        score: 40, max_possible: 50 },
    { dimension: 'Documento Legal',  score: 20, max_possible: 30 },
    { dimension: 'Conforto',         score: 10, max_possible: 20 },
  ]);
  const seg = r.find(x => x.dimension === 'Segurança');
  assert.equal(seg!.score, 60);
  assert.equal(seg!.max_possible, 80);
  assert.equal(r.find(x => x.dimension === 'Documento Legal'), undefined);
  assert.equal(r.find(x => x.dimension === 'Conforto')!.score, 10);
});

test('mergeSecurityDL cria linha Segurança se só houver DL', () => {
  const r = mergeSecurityDL([
    { dimension: 'Documento Legal', score: 20, max_possible: 30 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { dimension: 'Segurança', score: 20, max_possible: 30 });
});

test('mergeSecurityDL sem DL retorna lista intacta', () => {
  const rows = [
    { dimension: 'Segurança', score: 10, max_possible: 10 },
    { dimension: 'Conforto',  score: 5,  max_possible: 10 },
  ];
  assert.deepEqual(mergeSecurityDL(rows), rows);
});

test('mergeSecurityDL vazio retorna vazio', () => {
  assert.deepEqual(mergeSecurityDL([]), []);
});
