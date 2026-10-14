import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabela } from './tabela-parser.js';
import {
  rawToTabelaRows, addrKey, tipoEnderecoPorChave, dataCivil, afastamentoPorPrestador,
  type SguRawRow,
} from './sgu-raw.js';

const HOJE = '2026-10-14';

export function raw(over: Record<string, unknown> = {}): SguRawRow {
  return {
    codigo_prestador: '1000546', nome_prestador: 'SERGIO LUIZ BORTOLUZZI', nome_fantasia: null,
    status_prestador: 'ATIVO', grupo_prestador: '1 - MEDICOS COOPERADOS', tipo_prestador: '1 - MÉDICO',
    numero_documento: '352470968', numero_conselho_regional: 546,
    especialidade_grupo_servico: 'ANESTESIOLOGIA', nome_responsavel_tecnico: null,
    codigo_tipo_endereco: '2', tipo_endereco: 'COMERCIAL', cep: '88801250',
    logradouro: 'RUA CORONEL PEDRO BENEDET', numero_endereco: '505', complemento_endereco: 'SALA 609',
    bairro: 'CENTRO', cidade: 'CRICIUMA', uf_endereco: 'SC', telefone: '(48)30452678', celular: null,
    email_principal: null, imprimir_no_guia_medico: 'S',
    tipo_operacao_afastamento_exclusao: null, data_inicio_afastamento_exclusao: null,
    data_fim_afastamento_exclusao: null, codigo_motivo_afastamento_exclusao: null,
    motivo_afastamento_exclusao: null, dh_carga: new Date(2026, 9, 13, 21, 0),
    ...over,
  };
}

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
