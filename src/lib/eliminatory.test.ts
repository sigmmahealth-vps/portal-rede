// src/lib/eliminatory.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criterionKey, inheritEliminatory, diffEliminatory } from './eliminatory.js';

test('criterionKey: ignora acento, caixa, pontuação e espaços; code entra na chave', () => {
  assert.equal(
    criterionKey({ code: '1.1.3', text: '  Dispõe de Alvará   Sanitário válido? ' }),
    criterionKey({ code: '1.1.3', text: 'dispoe de alvara sanitario valido' }),
  );
  assert.notEqual(
    criterionKey({ code: '1.1.3', text: 'Alvará sanitário' }),
    criterionKey({ code: '1.1.4', text: 'Alvará sanitário' }),
  );
  assert.equal(criterionKey({ code: null, text: 'X' }), '|x');
});

test('inheritEliminatory: herda marcado e desmarcado da versão anterior', () => {
  const prev = [
    { code: '1.1.1', text: 'Alvará de funcionamento', is_eliminatory: true },
    { code: '1.1.5', text: 'CNES', is_eliminatory: false },
  ];
  const next = [
    { code: '1.1.1', text: 'Alvará de funcionamento' },
    { code: '1.1.5', text: 'CNES' },
    { code: '1.1.9', text: 'Critério novo' },
  ];
  const { flags, lost } = inheritEliminatory(prev, next);
  assert.deepEqual(flags, [true, false, false]); // novo nasce desmarcado
  assert.deepEqual(lost, []);
});

test('inheritEliminatory: texto alterado ou critério removido não herda e vai para lost', () => {
  const prev = [
    { code: '1.1.1', text: 'Alvará de funcionamento', is_eliminatory: true },
    { code: '1.1.2', text: 'Alvará dos bombeiros', is_eliminatory: true },
  ];
  const next = [{ code: '1.1.1', text: 'Alvará de funcionamento e localização' }];
  const { flags, lost } = inheritEliminatory(prev, next);
  assert.deepEqual(flags, [false]);
  assert.deepEqual(lost.map(l => l.code), ['1.1.1', '1.1.2']);
});

test('inheritEliminatory: chave repetida com marcações divergentes é ambígua → não herda', () => {
  const prev = [
    { code: '1.2.7', text: 'Mesmo texto', is_eliminatory: true },
    { code: '1.2.7', text: 'Mesmo texto', is_eliminatory: false },
  ];
  const { flags, lost } = inheritEliminatory(prev, [{ code: '1.2.7', text: 'Mesmo texto' }]);
  assert.deepEqual(flags, [false]);
  assert.equal(lost.length, 1);
});

test('inheritEliminatory: sem versão anterior → tudo desmarcado', () => {
  const { flags, lost } = inheritEliminatory([], [{ code: '1.1.1', text: 'A' }, { code: null, text: 'B' }]);
  assert.deepEqual(flags, [false, false]);
  assert.deepEqual(lost, []);
});

test('diffEliminatory: separa o que marcar, o que desmarcar e ids de fora do roteiro', () => {
  const current = [
    { id: 1, code: 'a', is_eliminatory: true },
    { id: 2, code: 'b', is_eliminatory: false },
    { id: 3, code: 'c', is_eliminatory: true },
  ];
  const d = diffEliminatory(current, [2, 3, 99]);
  assert.deepEqual(d.unknownIds, [99]);
  assert.deepEqual(d.toMark.map(c => c.id), [2]);
  assert.deepEqual(d.toUnmark.map(c => c.id), [1]);
});

test('diffEliminatory: lista vazia desmarca tudo (roteiro sem eliminatório é permitido)', () => {
  const d = diffEliminatory([{ id: 1, code: 'a', is_eliminatory: true }], []);
  assert.deepEqual(d.toUnmark.map(c => c.id), [1]);
  assert.deepEqual(d.toMark, []);
});
