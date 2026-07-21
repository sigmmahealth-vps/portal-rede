import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { AUDITOR_XLSX_HEADERS, buildAuditorXlsxRows, serializeAuditorXlsx, type XlsxSourceRow } from './auditorXlsx.js';

// ponytail: defaults+spread (not per-field ??) so explicit `null` overrides
// (e.g. completed_at: null) survive instead of being treated as nullish.
const row = (over: Partial<XlsxSourceRow & { id: number }> = {}) => ({
  id: 1,
  provider_name: 'Clínica X',
  provider_code: 'SGU-1',
  city: 'Criciúma',
  address: 'Rua A, 100',
  percentual: 82.5,
  seal: 'Prata',
  started_at: '2026-03-10',
  completed_at: '2026-05-20',
  status: 'finalizado',
  ...over,
});

test('AUDITOR_XLSX_HEADERS na ordem exata da spec', () => {
  assert.deepEqual([...AUDITOR_XLSX_HEADERS], [
    'Município', 'Logradouro', 'Prestador', 'Código',
    'Pontuação Total', 'Classificação',
    '% Segurança', '% Conforto', '% Experiência do Cliente',
    'Data de Envio', 'Data de Conclusão da Análise',
  ]);
});

test('buildAuditorXlsxRows monta 1 header + N linhas com as colunas certas', () => {
  const rows = buildAuditorXlsxRows(
    [row({ id: 42 })],
    { 42: { 'Segurança': 90, 'Conforto': 70, 'Experiência do Cliente': 85 } },
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], [...AUDITOR_XLSX_HEADERS]);
  assert.deepEqual(rows[1], [
    'Criciúma', 'Rua A, 100', 'Clínica X', 'SGU-1',
    82.5, 'Prata', 90, 70, 85, '2026-03-10', '2026-05-20',
  ]);
});

test('células vazias quando dimensão não avaliada ou completed_at ausente', () => {
  const rows = buildAuditorXlsxRows(
    [row({ id: 5, completed_at: null, seal: null })],
    { 5: { 'Segurança': 50 } },
  );
  assert.equal(rows[1][7], null); // Conforto
  assert.equal(rows[1][8], null); // Experiência
  assert.equal(rows[1][10], null); // Data de Conclusão
  assert.equal(rows[1][5], null); // Classificação
});

test('serializeAuditorXlsx gera buffer válido lível pelo xlsx', () => {
  const rows = buildAuditorXlsxRows([row({ id: 1 })], { 1: {} });
  const buf = serializeAuditorXlsx(rows);
  assert.ok(Buffer.isBuffer(buf));
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  assert.equal(aoa[0][0], 'Município');
  assert.equal(aoa[1][2], 'Clínica X');
});
