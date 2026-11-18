import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarStatus, conformidadeStatus, distribuicaoPorNivel } from './atributosMetrics.js';

test('contarStatus: conta por status e ignora desconhecidos', () => {
  const r = contarStatus([{ status: 'pendente' }, { status: 'valido' }, { status: 'valido' }, { status: 'reprovado' }, { status: 'outro' }]);
  assert.deepEqual(r, { pendente: 1, valido: 2, reprovado: 1, total: 4 });
});

test('contarStatus: lista vazia', () => {
  assert.deepEqual(contarStatus([]), { pendente: 0, valido: 0, reprovado: 0, total: 0 });
});

test('conformidadeStatus: valido / (valido+reprovado), pendentes fora', () => {
  assert.equal(conformidadeStatus([{ status: 'valido' }, { status: 'valido' }, { status: 'reprovado' }, { status: 'pendente' }]), 67);
});

test('conformidadeStatus: sem válidos/reprovados → 0', () => {
  assert.equal(conformidadeStatus([{ status: 'pendente' }]), 0);
  assert.equal(conformidadeStatus([]), 0);
});

test('distribuicaoPorNivel: ordem canônica, só n>0, ignora nível desconhecido', () => {
  const r = distribuicaoPorNivel([
    { nivel: 'mestrado' }, { nivel: 'graduacao' }, { nivel: 'graduacao' }, { nivel: 'xpto' },
  ]);
  assert.deepEqual(r, [{ nivel: 'graduacao', n: 2 }, { nivel: 'mestrado', n: 1 }]);
});

test('distribuicaoPorNivel: vazio', () => {
  assert.deepEqual(distribuicaoPorNivel([]), []);
});
