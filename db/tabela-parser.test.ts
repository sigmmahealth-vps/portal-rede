import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabela, type TabelaRow } from './tabela-parser.js';

function row(over: Record<string, unknown> = {}): TabelaRow {
  return {
    'Código do prestador': '1000546', 'Nome do prestador': 'SERGIO LUIZ BORTOLUZZI',
    'Nome Fantasia': null, CRM: '546', 'Situação do prestador': 'ATIVO',
    'Número do CPF e/ou CNJP': '352470968', 'Tipo de prestador': '01 - MÉDICO',
    'Grupo do Prestador': '1 - MEDICOS COOPERADOS', 'Especialidades/Gr Serv': '3-ANESTESIOLOGIA',
    'Nome Responsavel Técnico': null, Logradouro: 'RUA CORONEL PEDRO BENEDET',
    'Número': '505', Complemento: 'SALA 609', Bairro: 'CENTRO', CEP: '88801250',
    Cidade: 'CRICIUMA', UF: 'SC', Telefone: '(48)30452678', Celular: null, 'E-mail': null,
    'Tipo de Endereço': 'COMERCIAL',
    ...over,
  };
}

test('agrega linhas do mesmo código, junta especialidades e resolve roteiro', () => {
  const { providers } = parseTabela([
    row({ 'Especialidades/Gr Serv': '3-ANESTESIOLOGIA' }),
    row({ 'Especialidades/Gr Serv': '5-CARDIOLOGIA' }),
  ]);
  assert.equal(providers.length, 1);
  const p = providers[0];
  assert.equal(p.sgu_code, '1000546');
  assert.equal(p.person_type, 'PF');
  assert.equal(p.cpf, '00352470968');
  assert.equal(p.cnpj, null);
  assert.equal(p.provider_group, 'MEDICOS COOPERADOS');
  assert.equal(p.status, 'ativo');
  assert.equal(p.roteiro_cod, 'FOR-017');
  assert.equal(p.roteiro_confianca, 'Alta');
  assert.deepEqual([...p.specialties].sort(), ['ANESTESIOLOGIA', 'CARDIOLOGIA']);
  assert.equal(p.locations.length, 1);
  assert.equal(p.locations[0].is_primary, true);
  assert.equal(p.locations[0].in_medical_guide, true);
  assert.equal(p.locations[0].sgu_location_code, '1000546-1');
});

test('PJ pelo tipo, CNPJ pad p/ 14; AFASTADO vira inativo', () => {
  const { providers } = parseTabela([
    row({ 'Tipo de prestador': '05 - CLÍNICAS', 'Número do CPF e/ou CNJP': '15246302000111', 'Situação do prestador': 'AFASTADO', 'Grupo do Prestador': '6 - CLINICAS MEDICAS' }),
  ]);
  const p = providers[0];
  assert.equal(p.person_type, 'PJ');
  assert.equal(p.cnpj, '15246302000111');
  assert.equal(p.cpf, null);
  assert.equal(p.status, 'inativo');
  assert.equal(p.roteiro_cod, 'FOR-006');
});

test('endereços distintos viram múltiplas locations', () => {
  const { providers } = parseTabela([
    row({ CEP: '88801250', Logradouro: 'RUA A', 'Número': '1' }),
    row({ CEP: '88820000', Logradouro: 'RUA B', 'Número': '2' }),
    row({ CEP: '88801250', Logradouro: 'RUA A', 'Número': '1' }),
  ]);
  assert.equal(providers[0].locations.length, 2);
  assert.equal(providers[0].locations[1].sgu_location_code, '1000546-2');
});

test('CPF/CNPJ repetido entre códigos distintos é zerado no segundo, com aviso', () => {
  const { providers, warnings } = parseTabela([
    row({ 'Código do prestador': '1000546', 'Número do CPF e/ou CNJP': '352470968' }),
    row({ 'Código do prestador': '1000999', 'Número do CPF e/ou CNJP': '352470968' }),
  ]);
  assert.equal(providers.length, 2);
  const dup = providers.find((p) => p.sgu_code === '1000999')!;
  assert.equal(dup.cpf, null);
  assert.ok(warnings.length >= 1);
});
