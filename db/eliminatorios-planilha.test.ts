import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planejarEliminatorios, textoConfirma } from './eliminatorios-planilha.ts';

const q = (id: number, code: string, text: string, is_eliminatory = false) => ({ id, code, text, is_eliminatory });
const it = (item: string, tipoDoc: string, roteiro = 'FOR-001') => ({ roteiro, item, tipoDoc });

test('texto do critério confirma o tipo de documento', () => {
  assert.ok(textoConfirma('alvará corpo de bombeiros', 'Dispõe de alvará do Corpo de Bombeiros/Auto de Vistoria'));
  assert.ok(textoConfirma('alvará sanitário', 'Dispõe de alvará sanitário válido ou protocolo'));
  assert.ok(textoConfirma('anotação de responsabilidade técnica COREN', 'Dispõe de Anotação de Responsabilidade Técnica'));
  assert.ok(textoConfirma('autorização de funcionamento CNEN', 'autorização de Funcionamento pela Comissão Nacional de Energia Nuclear'));
  assert.ok(!textoConfirma('anotação de responsabilidade técnica', 'Cadastro Nacional Estabelecimento Saúde (CNES)'));
  assert.ok(!textoConfirma('alvará de funcionamento', 'autorização de Funcionamento pela Comissão Nacional de Energia Nuclear'));
});

test('marca o que a planilha lista e o texto confirma; desmarca o resto', () => {
  const crit = [q(1, '1.1.1', 'Dispõe de alvará de funcionamento válido'), q(2, '1.1.5', 'CNES', true),
    q(3, '1.1.4', 'Cadastro Nacional Estabelecimento Saúde (CNES)')];
  const p = planejarEliminatorios([it('1.1.1', 'alvará de funcionamento'), it('1.1.4', 'anotação de responsabilidade técnica'),
    it('1.1.9', 'alvará sanitário')], crit);
  assert.deepEqual(p.marcar.map((c) => c.id), [1]);
  assert.deepEqual(p.desmarcar.map((c) => c.id), [2]);
  assert.deepEqual(p.divergentes.map((d) => d.item), ['1.1.4']);
  assert.deepEqual(p.ausentes.map((d) => d.item), ['1.1.9']);
});

test('divergência aceita explicitamente é marcada', () => {
  const p = planejarEliminatorios([it('1.1.4', 'anotação de responsabilidade técnica', 'FOR-017')],
    [q(7, '1.1.4', 'Declaração de regularidade no conselho Regional de medicina (CRM)')], new Set(['FOR-017:1.1.4']));
  assert.deepEqual(p.final.map((c) => c.id), [7]);
  assert.equal(p.divergentes.length, 0);
});
