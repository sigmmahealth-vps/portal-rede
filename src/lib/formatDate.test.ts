import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtData, fmtDataHora, fmtPct } from './formatDate.ts';

test('data-só nunca volta um dia (independe do fuso)', () => {
  assert.equal(fmtData('2027-01-13'), '13/01/2027');
  assert.equal(fmtData('2027-01-13T00:00:00.000Z'), '13/01/2027'); // meia-noite UTC
});

test('sempre dd/mm/aaaa', () => {
  assert.equal(fmtData('2026-12-31'), '31/12/2026');
});

test('vazio/inválido vira string vazia', () => {
  assert.equal(fmtData(null), '');
  assert.equal(fmtData(''), '');
  assert.equal(fmtData('nao-e-data'), '');
});

test('data e hora saem em pt-BR', () => {
  const s = fmtDataHora('2027-01-13T15:30:00');
  assert.match(s, /^13\/01\/2027/);
  assert.equal(fmtDataHora(null), '');
});

test('fmtPct: 1 casa decimal com vírgula, nunca arredonda para inteiro (B-03)', () => {
  assert.equal(fmtPct(95.7), '95,7%');    // era 96% (arredondado) — o bug
  assert.equal(fmtPct(95.71), '95,7%');   // 2 casas -> 1
  assert.equal(fmtPct(66.7), '66,7%');
  assert.equal(fmtPct(100), '100,0%');    // sempre 1 casa (homologação 25/09)
  assert.equal(fmtPct(89.7), '89,7%');
  assert.equal(fmtPct(0), '0,0%');
  assert.equal(fmtPct(null), '');
  assert.equal(fmtPct('nao-e-numero'), '');
});
