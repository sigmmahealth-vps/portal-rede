import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProviders, normalizeDoc, type RawRow } from './providers-parser.js';

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
