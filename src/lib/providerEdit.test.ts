import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerCanEditCriterion } from './providerEdit.js';

test('D-04: em reanálise, prestador só edita critério devolvido ou em reedição', () => {
  const st = 'aguardando_evidencia';
  assert.equal(providerCanEditCriterion(st, 'aguardando_reanalise'), true);
  assert.equal(providerCanEditCriterion(st, 'pendente'), true);
  // O bug do ticket: aprovado/reprovado NÃO podem ser reeditados na reanálise.
  assert.equal(providerCanEditCriterion(st, 'aprovado'), false);
  assert.equal(providerCanEditCriterion(st, 'reprovado'), false);
  assert.equal(providerCanEditCriterion(st, null), false);
});

test('preenchimento normal libera qualquer critério', () => {
  assert.equal(providerCanEditCriterion('em_andamento', null), true);
  assert.equal(providerCanEditCriterion('em_andamento', 'aprovado'), true);
  assert.equal(providerCanEditCriterion('pendente', null), true);
});

test('fora dos estados de edição o prestador não escreve', () => {
  for (const st of ['em_analise', 'aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado']) {
    assert.equal(providerCanEditCriterion(st, 'aguardando_reanalise'), false, st);
  }
});
