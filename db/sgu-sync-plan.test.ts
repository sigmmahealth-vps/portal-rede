import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checarTravas, planejarRekey, planejarSync, type PortalPrestadorSync } from './sgu-sync-plan.js';
import { raw } from './sgu-test-fixtures.js';

const portal = (over: Partial<PortalPrestadorSync> = {}): PortalPrestadorSync => ({
  id: 10, sgu_code: '1000546', status: 'ativo', source: 'sgu',
  locations: [{ id: 100, sgu_location_code: '1000546-2', active: true }], ...over,
});

test('existente: atualiza prestador e unidade de mesmo código; nada mais', () => {
  const p = planejarSync([raw()], [portal()]);
  assert.deepEqual(p.atualizar.map((a) => a.id), [10]);
  assert.deepEqual(p.unidadesAtualizar.map((u) => [u.id, u.loc.sgu_location_code]), [[100, '1000546-2']]);
  assert.deepEqual([p.inserir, p.unidadesNovas, p.unidadesInativar, p.excluirPorAusencia], [[], [], [], []]);
  assert.equal(p.ativos, 1);
  assert.equal(p.ativosQueSaem, 0);
});

test('novos: ATIVO e AFASTADO entram; EXCLUÍDO é ignorado', () => {
  const p = planejarSync([
    raw({ codigo_prestador: '2000001', numero_documento: '1' }),
    raw({ codigo_prestador: '2000002', numero_documento: '2', status_prestador: 'AFASTADO' }),
    raw({ codigo_prestador: '2000003', numero_documento: '3', status_prestador: 'EXCLUÍDO' }),
  ], []);
  assert.deepEqual(p.inserir.map((s) => [s.sgu_code, s.status]), [['2000001', 'ativo'], ['2000002', 'afastado']]);
  assert.deepEqual(p.ignorados.excluido_novo, ['2000003']);
});

test('grupo 27: ignorado como novo e não tocado como existente', () => {
  const g27 = { grupo_prestador: '27 - PRESTADOR SEM VINCULO -  XML-TISS' };
  const p = planejarSync([raw(g27), raw({ ...g27, codigo_prestador: '2000001', numero_documento: '1' })], [portal()]);
  assert.deepEqual(p.ignorados.grupo_27.sort(), ['1000546', '2000001']);
  assert.deepEqual([p.inserir, p.atualizar, p.excluirPorAusencia, p.unidadesInativar], [[], [], [], []]);
});

test('ausente vira exclusão (conta na saída se ativo); ausente já excluído não', () => {
  const p = planejarSync([raw()], [portal(),
    portal({ id: 11, sgu_code: '5000001', locations: [] }),
    portal({ id: 12, sgu_code: '5000002', status: 'excluído', locations: [] })]);
  assert.deepEqual(p.excluirPorAusencia, [11]);
  assert.equal(p.ativos, 2);
  assert.equal(p.ativosQueSaem, 1);
});

test('existente ativo que vem EXCLUÍDO conta na saída', () => {
  const p = planejarSync([raw({ status_prestador: 'EXCLUÍDO' })], [portal()]);
  assert.equal(p.ativosQueSaem, 1);
  assert.equal(p.atualizar[0].p.status, 'excluído');
});

test('unidades: nova (com o prestador), sumida ativa inativa, sumida já inativa não', () => {
  const p = planejarSync(
    [raw(), raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })],
    [portal({ locations: [
      { id: 100, sgu_location_code: '1000546-2', active: true },
      { id: 101, sgu_location_code: '1000546-9', active: true },
      { id: 102, sgu_location_code: '1000546-8', active: false },
    ] })]);
  assert.deepEqual(p.unidadesNovas.map((u) => [u.provider_id, u.prestador.sgu_code, u.loc.sgu_location_code]),
    [[10, '1000546', '1000546-3']]);
  assert.deepEqual(p.unidadesInativar, [101]);
});

test('unidade inativa que volta na raw é atualizada (reativa), não recriada', () => {
  const p = planejarSync([raw()], [portal({ locations: [{ id: 100, sgu_location_code: '1000546-2', active: false }] })]);
  assert.deepEqual(p.unidadesAtualizar.map((u) => u.id), [100]);
  assert.deepEqual(p.unidadesNovas, []);
});

test('checarTravas: raw vazia, duas cargas, mais de 10% saindo', () => {
  const vazio = planejarSync([], []);
  assert.match(checarTravas([], vazio) ?? '', /vazia/);
  const duas = [raw({ dh_carga_txt: '2026-10-13 23:00:50.80752' }), raw({ dh_carga_txt: '2026-10-14 23:00:00' })];
  assert.match(checarTravas(duas, planejarSync(duas, [])) ?? '', /2 cargas/);
  const dez = Array.from({ length: 10 }, (_, i) => portal({ id: i + 1, sgu_code: `90${i}`, locations: [] }));
  const nove = dez.slice(0, 9).map((p, i) => raw({ codigo_prestador: p.sgu_code, numero_documento: String(i + 1) }));
  assert.equal(checarTravas(nove, planejarSync(nove, dez)), null);            // 1 de 10 sai: no limite
  const oito = nove.slice(0, 8);
  assert.match(checarTravas(oito, planejarSync(oito, dez)) ?? '', /2 de 10/);  // 2 de 10: aborta
});

test('planejarRekey: casa por endereço mantendo id; não casado e endereço repetido vão para inativar com -x', () => {
  const base = { provider_id: 10, sgu_code: '1000546', sgu_tipo_endereco: null };
  const unidades = [
    { ...base, id: 1, sgu_location_code: '1000546-1', cep: '88801250', logradouro: 'RUA CORONEL PEDRO BENEDET', numero: '505' },
    { ...base, id: 2, sgu_location_code: '1000546-2', cep: '88801250', logradouro: 'RUA B', numero: '10' },
    { ...base, id: 3, sgu_location_code: '1000546-3', cep: '88800000', logradouro: 'RUA SUMIU', numero: '1' },
    { ...base, id: 4, sgu_location_code: '1000546-4', cep: '88801250', logradouro: 'rua b', numero: '10' },
    { ...base, id: 5, sgu_location_code: '1000546-7', sgu_tipo_endereco: '7', cep: null, logradouro: null, numero: null },
    { ...base, id: 6, sgu_location_code: '1000546-5-x', cep: null, logradouro: null, numero: null },
  ];
  const r = planejarRekey(unidades, [raw(), raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })]);
  assert.deepEqual(r.rekey, [{ id: 1, codigo: '1000546-2', tipo: '2' }, { id: 2, codigo: '1000546-3', tipo: '3' }]);
  assert.deepEqual(r.inativar, [{ id: 3, codigo: '1000546-3-x' }, { id: 4, codigo: '1000546-4-x' }]);
});

test('planejarRekey: duas unidades sem código não colidem no -x', () => {
  const base = { provider_id: 10, sgu_code: '1000546', sgu_tipo_endereco: null, sgu_location_code: null, cep: null, logradouro: 'X', numero: '1' };
  const r = planejarRekey([{ ...base, id: 7 }, { ...base, id: 8 }], [raw()]);
  assert.deepEqual(r.inativar, [{ id: 7, codigo: '1000546-7-x' }, { id: 8, codigo: '1000546-8-x' }]);
});

test('cadastro manual com sgu_code na raw é ignorado (não insere, não atualiza); manual ausente não é excluído', () => {
  const p = planejarSync([raw()], [{ ...portal(), source: 'manual' }, portal({ id: 11, sgu_code: '5000001', source: 'manual', locations: [] })]);
  assert.deepEqual(p.ignorados.manual, ['1000546']);
  assert.deepEqual([p.inserir, p.atualizar, p.excluirPorAusencia, p.unidadesNovas], [[], [], [], []]);
  assert.equal(p.ativos, 0);
});

test('planejarRekey: único par sobrando é a mesma unidade com endereço novo', () => {
  const base = { provider_id: 10, sgu_code: '1000546', sgu_tipo_endereco: null };
  const r = planejarRekey(
    [{ ...base, id: 1, sgu_location_code: '1000546-1', cep: '88811560', logradouro: 'RUA AUGUSTO DOS ANJOS', numero: '270' }],
    [raw({ codigo_tipo_endereco: '10', cep: '88811660', logradouro: 'RUA GUERRA JUNQUEIRA', numero_endereco: '235' })]);
  assert.deepEqual(r.rekey, [{ id: 1, codigo: '1000546-10', tipo: '10', mudou_endereco: true }]);
  assert.deepEqual(r.inativar, []);
});

test('planejarRekey: sobra ambígua (2 endereços novos para 1 unidade) continua inativando', () => {
  const base = { provider_id: 10, sgu_code: '1000546', sgu_tipo_endereco: null };
  const r = planejarRekey(
    [{ ...base, id: 1, sgu_location_code: '1000546-1', cep: '1', logradouro: 'VELHA', numero: '1' }],
    [raw({ codigo_tipo_endereco: '3', cep: '2', logradouro: 'A', numero_endereco: '1' }),
     raw({ codigo_tipo_endereco: '4', cep: '3', logradouro: 'B', numero_endereco: '1' })]);
  assert.deepEqual(r.rekey, []);
  assert.deepEqual(r.inativar, [{ id: 1, codigo: '1000546-1-x' }]);
});

test('planejarRekey: número com zero à esquerda casa pelo endereço', () => {
  const base = { provider_id: 10, sgu_code: '1000546', sgu_tipo_endereco: null };
  const r = planejarRekey(
    [{ ...base, id: 1, sgu_location_code: '1000546-1', cep: '88840000', logradouro: 'RUA BARAO DO RIO BRANCO', numero: '9' }],
    [raw({ codigo_tipo_endereco: '2', cep: '88840000', logradouro: 'RUA BARAO DO RIO BRANCO', numero_endereco: '09' }),
     raw({ codigo_tipo_endereco: '6', cep: '88803020', logradouro: 'RUA MAESTRO JACO', numero_endereco: '357' })]);
  assert.deepEqual(r.rekey, [{ id: 1, codigo: '1000546-2', tipo: '2' }]);
});
