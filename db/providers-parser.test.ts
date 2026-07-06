import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProviders, normalizeDoc, parseAddress, buildLocations, type RawRow } from './providers-parser.js';

function row(over: Record<string, unknown> = {}): RawRow {
  return {
    'Código Prestador': '4000059', 'CRM': '0', 'Razão Social': 'HOSPITAL X',
    'Razão Social Abrev': 'HOSP X', 'Tipo Prestador': 'HOSPITAL', 'GRUPO_PREST': 'HOSPITAIS',
    'Desc. Área de Atuação': '', 'Especialidade': 'CARDIOLOGIA', 'Espec. Principal': '',
    'CNPJ': 82996712000163, 'CPF': '', 'PREST_MOT_EXCL': '',
    'ROTEIRO_COD': 'FOR-024', 'CONFIANCA': 'Alta',
    ...over,
  };
}

test('normalizeDoc faz zero-pad e sinaliza tamanho inválido', () => {
  assert.deepEqual(normalizeDoc(34390006991, 11), { value: '34390006991', invalid: false });
  assert.deepEqual(normalizeDoc(1234567890, 11), { value: '01234567890', invalid: false }); // recupera zero à esquerda
  assert.deepEqual(normalizeDoc('', 11), { value: null, invalid: false });
  assert.equal(normalizeDoc('123456789012345', 14).invalid, true); // 15 dígitos > 14
});

test('parseProviders agrega linhas do mesmo código em 1 prestador', () => {
  const { providers } = parseProviders([
    row({ 'Especialidade': 'CARDIOLOGIA' }),
    row({ 'Especialidade': 'PEDIATRIA' }),
    row({ 'Especialidade': 'CARDIOLOGIA' }), // duplicada
  ]);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].sgu_code, '4000059');
  assert.deepEqual(providers[0].specialties, ['CARDIOLOGIA', 'PEDIATRIA']);
  assert.equal(providers[0].person_type, 'PJ');
  assert.equal(providers[0].cnpj, '82996712000163');
  assert.equal(providers[0].council_registry, null); // CRM '0' vira null
  assert.equal(providers[0].roteiro_cod, 'FOR-024');
  assert.equal(providers[0].roteiro_confianca, 'Alta');
});

test('Espec. Principal vem na frente das especialidades', () => {
  const { providers } = parseProviders([
    row({ 'Especialidade': 'CARDIOLOGIA', 'Espec. Principal': 'PEDIATRIA' }),
  ]);
  assert.deepEqual(providers[0].specialties, ['PEDIATRIA', 'CARDIOLOGIA']);
});

test('PF por CPF; status inativo quando há motivo de exclusão', () => {
  const { providers } = parseProviders([
    row({ 'Código Prestador': '5001', 'CNPJ': '', 'CPF': '34390006991',
          'CRM': '12345', 'PREST_MOT_EXCL': 'FALECEU' }),
  ]);
  assert.equal(providers[0].person_type, 'PF');
  assert.equal(providers[0].cpf, '34390006991');
  assert.equal(providers[0].council_registry, '12345');
  assert.equal(providers[0].status, 'inativo');
});

test('CNPJ repetido entre códigos diferentes é zerado no segundo', () => {
  const { providers, warnings } = parseProviders([
    row({ 'Código Prestador': 'A1', 'CNPJ': 82996712000163 }),
    row({ 'Código Prestador': 'A2', 'CNPJ': 82996712000163 }),
  ]);
  const a1 = providers.find((p) => p.sgu_code === 'A1')!;
  const a2 = providers.find((p) => p.sgu_code === 'A2')!;
  assert.equal(a1.cnpj, '82996712000163');
  assert.equal(a2.cnpj, null); // duplicado zerado
  assert.equal(a2.person_type, 'PJ'); // continua PJ
  assert.ok(warnings.some((w) => w.includes('CNPJ') && w.includes('A2')));
});

test('parseAddress separa logradouro, número, cidade e UF', () => {
  const a = parseAddress('RUA VITAL BRASIL, 455 - HOSPITAL SAO JOAO - CRUZEIRO DO SUL - CRICIUMA - SC');
  assert.equal(a.logradouro, 'RUA VITAL BRASIL');
  assert.equal(a.numero, '455');
  assert.equal(a.cidade, 'CRICIUMA');
  assert.equal(a.uf, 'SC');
});

test('parseAddress cai para logradouro cru quando não dá para separar', () => {
  const a = parseAddress('ENDERECO SEM PADRAO');
  assert.equal(a.logradouro, 'ENDERECO SEM PADRAO');
  assert.equal(a.uf, null);
});

test('buildLocations cria comercial primário (guia médico) e residencial secundário', () => {
  const locs = buildLocations(row({
    'Endereço Comercial': 'RUA A, 10 - CENTRO - CRICIUMA - SC', 'CEP Comercial': '88801-000',
    'Endereço Residencial': 'RUA B, 20 - PROSPERA - CRICIUMA - SC', 'CEP Residencial': '88815-000',
    'Telefone': '48 3433-0000', 'Email': 'x@y.com',
  }), '4000059');
  assert.equal(locs.length, 2);
  const com = locs.find((l) => l.label === 'Comercial')!;
  assert.equal(com.is_primary, true);
  assert.equal(com.in_medical_guide, true);
  assert.equal(com.phone, '48 3433-0000');
  assert.equal(com.email, 'x@y.com');
  assert.equal(com.sgu_location_code, '4000059-COM');
  const res = locs.find((l) => l.label === 'Residencial')!;
  assert.equal(res.is_primary, false);
  assert.equal(res.in_medical_guide, false);
});

test('parseProviders preenche locations do prestador', () => {
  const { providers } = parseProviders([
    row({ 'Endereço Comercial': 'RUA A, 10 - CENTRO - CRICIUMA - SC', 'CEP Comercial': '88801-000' }),
  ]);
  assert.equal(providers[0].locations.length, 1);
  assert.equal(providers[0].locations[0].label, 'Comercial');
});
