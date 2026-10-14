import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabela } from './tabela-parser.js';
import {
  rawToTabelaRows, addrKey, tipoEnderecoPorChave, dataCivil, afastamentoPorPrestador,
  type SguRawRow, diffProviders, type PortalProvider,
} from './sgu-raw.js';
import { HOJE, raw } from './sgu-test-fixtures.js';

test('raw traduzida passa pelo parseTabela: PF, CPF, CRM, especialidades agregadas, guia', () => {
  const rows = [raw(), raw({ especialidade_grupo_servico: 'CLINICA MEDICA', imprimir_no_guia_medico: 'N' })];
  const [p] = parseTabela(rawToTabelaRows(rows)).providers;
  assert.equal(p.sgu_code, '1000546');
  assert.equal(p.person_type, 'PF');
  assert.equal(p.cpf, '00352470968');
  assert.equal(p.council_registry, '546');
  assert.equal(p.status, 'ativo');
  assert.equal(p.provider_group, 'MEDICOS COOPERADOS');
  assert.deepEqual(p.specialties, ['ANESTESIOLOGIA', 'CLINICA MEDICA']);
  assert.equal(p.locations.length, 1);
  assert.equal(p.locations[0].in_medical_guide, true); // 1ª linha do endereço decide
  assert.equal(p.locations[0].complemento, 'SALA 609');
});

test('addrKey normaliza CEP, caixa e espaços', () => {
  assert.equal(addrKey('88801-250', ' rua  x ', ' 5 '), '88801250|RUA X|5');
});

test('tipoEnderecoPorChave liga prestador+endereço ao codigo_tipo_endereco', () => {
  const m = tipoEnderecoPorChave([raw(), raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })]);
  assert.equal(m.get(`1000546#${addrKey('88801250', 'RUA CORONEL PEDRO BENEDET', '505')}`), '2');
  assert.equal(m.get(`1000546#${addrKey('88801250', 'RUA B', '10')}`), '3');
});

test('dataCivil usa a data local de Date e o prefixo de string', () => {
  assert.equal(dataCivil(new Date(2026, 10, 1)), '2026-11-01');
  assert.equal(dataCivil('2022-10-05 00:00:00'), '2022-10-05');
  assert.equal(dataCivil(null), null);
});

test('afastamentoPorPrestador classifica as cinco situações', () => {
  const rows = [
    raw({ codigo_prestador: '1' }),
    raw({ codigo_prestador: '2', status_prestador: 'AFASTADO', tipo_operacao_afastamento_exclusao: 'AFASTAMENTO',
          data_inicio_afastamento_exclusao: new Date(2026, 0, 28), motivo_afastamento_exclusao: 'AFASTADO',
          codigo_motivo_afastamento_exclusao: 7 }),
    raw({ codigo_prestador: '3', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
          data_inicio_afastamento_exclusao: new Date(2026, 10, 1) }),
    raw({ codigo_prestador: '4', tipo_operacao_afastamento_exclusao: 'AFASTAMENTO',
          data_inicio_afastamento_exclusao: new Date(2019, 10, 29), data_fim_afastamento_exclusao: new Date(2020, 1, 1) }),
    raw({ codigo_prestador: '5', status_prestador: 'EXCLUÍDO', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
          data_inicio_afastamento_exclusao: new Date(2024, 5, 1), motivo_afastamento_exclusao: 'FALECEU' }),
    raw({ codigo_prestador: '6', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
          data_inicio_afastamento_exclusao: new Date(2024, 5, 1) }),
  ];
  const m = afastamentoPorPrestador(rows, HOJE);
  assert.equal(m.get('1')!.situacao, 'nenhum');
  assert.deepEqual(m.get('2'), {
    operacao: 'AFASTAMENTO', inicio: '2026-01-28', fim: null, codigo_motivo: '7', motivo: 'AFASTADO', situacao: 'vigente',
  });
  assert.equal(m.get('3')!.situacao, 'exclusao_agendada');
  assert.equal(m.get('4')!.situacao, 'afastamento_encerrado');
  assert.equal(m.get('5')!.situacao, 'vigente');
  assert.equal(m.get('6')!.situacao, 'inconsistente'); // ATIVO com exclusão já passada
});

// Retrato do Portal idêntico ao que a raw geraria — base "sem diferença".
function portalDe(rows: SguRawRow[], extra: Partial<PortalProvider> = {}): PortalProvider[] {
  return parseTabela(rawToTabelaRows(rows)).providers.map((s) => ({
    sgu_code: s.sgu_code, name: s.name, trade_name: s.trade_name, cnpj: s.cnpj, cpf: s.cpf,
    status: s.status, provider_type: s.provider_type, provider_group: s.provider_group,
    specialties: s.specialties, responsavel_tecnico: s.responsavel_tecnico, roteiro_cod: s.roteiro_cod,
    tem_avaliacao: false,
    locations: s.locations.map(({ cep, logradouro, numero, complemento, bairro, cidade, uf, phone, email, in_medical_guide }) =>
      ({ cep, logradouro, numero, complemento, bairro, cidade, uf, phone, email, in_medical_guide })),
    ...extra,
  }));
}

test('diff: mesma base não gera diferença', () => {
  const r = diffProviders([raw()], portalDe([raw()]), HOJE);
  assert.deepEqual([r.novos, r.ausentes, r.alterados, r.unidades, r.afastamentos], [[], [], [], [], []]);
});

test('diff: novo e ausente (com avaliação)', () => {
  const r = diffProviders(
    [raw(), raw({ codigo_prestador: '2000001', nome_prestador: 'NOVO', status_prestador: 'EXCLUÍDO' })],
    [...portalDe([raw()]), ...portalDe([raw({ codigo_prestador: '3000001', nome_prestador: 'SUMIU' })], { tem_avaliacao: true })],
    HOJE);
  assert.deepEqual(r.novos.map((n) => [n.sgu_code, n.status]), [['2000001', 'excluído']]);
  assert.deepEqual(r.ausentes, [{ sgu_code: '3000001', name: 'SUMIU', status: 'ativo', tem_avaliacao: true }]);
});

test('diff: campo alterado aparece com antes/depois; especialidades reordenadas e caixa não contam', () => {
  const rows = [raw(), raw({ especialidade_grupo_servico: 'CLINICA MEDICA' })];
  const [p] = portalDe(rows, { name: 'Sergio Luiz Bortoluzzi', specialties: ['CLINICA MEDICA', 'ANESTESIOLOGIA'], status: 'afastado' });
  const r = diffProviders(rows, [p], HOJE);
  assert.deepEqual(r.alterados, [{
    sgu_code: '1000546', name: 'SERGIO LUIZ BORTOLUZZI',
    campos: [{ campo: 'status', portal: 'afastado', sgu: 'ativo' }],
  }]);
});

test('diff: unidade nova (com codigo_tipo_endereco), removida e alterada', () => {
  const rows = [raw({ email_principal: 'novo@x.com' }),
    raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })];
  const [p] = portalDe([raw({ email_principal: 'antigo@x.com' })]);
  p.locations.push({ ...p.locations[0], logradouro: 'RUA VELHA', numero: '1' });
  const r = diffProviders(rows, [p], HOJE);
  assert.equal(r.unidades.length, 1);
  const u = r.unidades[0];
  assert.deepEqual(u.novas.map((l) => [l.logradouro, l.codigo_tipo_endereco]), [['RUA B', '3']]);
  assert.deepEqual(u.removidas.map((l) => l.logradouro), ['RUA VELHA']);
  assert.deepEqual(u.alteradas.map((a) => a.campos), [[{ campo: 'email', portal: 'antigo@x.com', sgu: 'novo@x.com' }]]);
  assert.equal(u.alteradas[0].codigo_tipo_endereco, '2');
});

test('diff: afastamentos só de quem está no Portal e com situação diferente de nenhum', () => {
  const afastado = raw({ status_prestador: 'AFASTADO', tipo_operacao_afastamento_exclusao: 'AFASTAMENTO',
    data_inicio_afastamento_exclusao: new Date(2026, 0, 28) });
  const agendado = raw({ codigo_prestador: '7', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
    data_inicio_afastamento_exclusao: new Date(2026, 10, 1) });
  const r = diffProviders([afastado, agendado, raw({ codigo_prestador: '8' })],
    portalDe([afastado, agendado, raw({ codigo_prestador: '8' })]), HOJE);
  assert.deepEqual(r.afastamentos.map((a) => [a.sgu_code, a.situacao]), [['7', 'exclusao_agendada'], ['1000546', 'vigente']]);
});

test('diff: código antigo EXCLUÍDO com o mesmo CPF não tira o documento do código ativo', () => {
  const antigo = raw({ codigo_prestador: '19000546', status_prestador: 'EXCLUÍDO',
    tipo_operacao_afastamento_exclusao: 'EXCLUSAO', data_inicio_afastamento_exclusao: new Date(2024, 0, 1),
    motivo_afastamento_exclusao: 'MUDOU DE CÓDIGO' });
  const rows = [antigo, raw()];
  const r = diffProviders(rows, portalDe([raw()]), HOJE);
  assert.deepEqual(r.alterados, []);
  assert.equal(rows[0], antigo); // não reordena o array de quem chamou
});

test('diff: resultado não depende da ordem das linhas da raw', () => {
  const rows = [
    raw({ email_principal: 'a@x.com', telefone: '111' }),
    raw({ especialidade_grupo_servico: 'CLINICA MEDICA', email_principal: 'b@x.com', telefone: '111' }),
    raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10', telefone: '222', email_principal: 'c@x.com' }),
    raw({ codigo_prestador: '2000546', nome_prestador: 'OUTRO CODIGO', status_prestador: 'AFASTADO',
          tipo_operacao_afastamento_exclusao: 'AFASTAMENTO', data_inicio_afastamento_exclusao: new Date(2026, 0, 28),
          telefone: '333', email_principal: 'd@x.com' }),
    raw({ codigo_prestador: '2000546', nome_prestador: 'OUTRO CODIGO', status_prestador: 'AFASTADO',
          tipo_operacao_afastamento_exclusao: 'AFASTAMENTO', data_inicio_afastamento_exclusao: new Date(2026, 0, 29),
          especialidade_grupo_servico: 'CLINICA MEDICA', telefone: '333', email_principal: 'e@x.com' }),
    raw({ codigo_prestador: '3000001', nome_prestador: 'TERCEIRO', numero_documento: '999', status_prestador: 'ATIVO' }),
  ];
  const rotacionado = [...rows.slice(2), ...rows.slice(0, 2)];
  for (const portal of [[], portalDe(rows)]) {
    const base = diffProviders(rows, portal, HOJE);
    assert.deepEqual(diffProviders([...rows].reverse(), portal, HOJE), base);
    assert.deepEqual(diffProviders(rotacionado, portal, HOJE), base);
  }
});

test('raw traduzida leva o codigo_tipo_endereco ao código da unidade', () => {
  const [p] = parseTabela(rawToTabelaRows([raw({ codigo_tipo_endereco: '4' })])).providers;
  assert.equal(p.locations[0].sgu_location_code, '1000546-4');
});
