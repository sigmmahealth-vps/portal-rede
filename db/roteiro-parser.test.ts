import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseWorkbook, num, extractDocumentType } from './roteiro-parser.js';

/** Monta uma planilha mínima em memória no layout esperado pelo parser. */
function buildBuffer(): Buffer {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Revisão: 03'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará sanitário?', '', '10', '8'],
    ['1.1.2 Possui plano PGRSS?', 'Documento do PGRSS', '5', '5'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('parseWorkbook conta seções, critérios e pontuação total', () => {
  const parsed = parseWorkbook(buildBuffer(), 'OPS-RED-FOR-017 - Teste.xlsx');
  assert.equal(parsed.sections.length, 2); // grupo + seção
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.questions.reduce((s, q) => s + q.maxScore, 0), 15);
  assert.equal(parsed.version, '03');
  assert.equal(parsed.sourceFile, 'OPS-RED-FOR-017 - Teste.xlsx');
  assert.ok(parsed.opsCode.includes('OPS-RED-FOR-017'));
});

test('parseWorkbook marca evidência obrigatória só quando há coluna de evidência', () => {
  const parsed = parseWorkbook(buildBuffer(), 'OPS-RED-FOR-017 - Teste.xlsx');
  const comEvid = parsed.questions.find((q) => q.code === '1.1.2');
  const semEvid = parsed.questions.find((q) => q.code === '1.1.1');
  assert.ok(comEvid && semEvid);
  assert.equal(comEvid!.evidenceRequired, true);
  assert.equal(semEvid!.evidenceRequired, false);
});

test('parseWorkbook sinaliza cabeçalho ausente e devolve 0 critérios', () => {
  const ws = XLSX.utils.aoa_to_sheet([['planilha qualquer'], ['sem cabeçalho']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'X');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'sem-cabecalho.xlsx');
  assert.equal(parsed.questions.length, 0);
  assert.ok(parsed.orphans.some((o) => o.startsWith('!!')));
});

test('num converte células numéricas corretamente', () => {
  assert.equal(num('10'), 10);
  assert.equal(num('10,5'), 10.5);
  assert.equal(num(''), null);
  assert.equal(num(null), null);
});

/** Planilha extra para testar weight-fallback e isEliminatory. */
function buildBuffer2(): Buffer {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Revisão: 01'],
    ['GRUPO EXTRA'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 2. Contratos'],
    // weight-fallback: colCons (col 3) is empty → weight should equal maxScore (col 2 = 20)
    ['2.1.1 Critério sem peso à considerar', '', '20', ''],
    // isEliminatory: text in col A contains "eliminatório"
    ['2.1.2 Critério eliminatório do processo', '', '10', '10'],
    // normal: isEliminatory should be false
    ['2.1.3 Critério comum', '', '5', '5'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro2');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('parseWorkbook: weight cai para maxScore quando PESO À CONSIDERAR está vazio', () => {
  const parsed = parseWorkbook(buildBuffer2(), 'OPS-RED-FOR-099 - Extra.xlsx');
  const q = parsed.questions.find((q) => q.code === '2.1.1');
  assert.ok(q, 'questão 2.1.1 deve existir');
  assert.equal(q.maxScore, 20);
  assert.equal(q.weight, 20); // fallback: weight === maxScore
});

test('parseWorkbook: isEliminatory detecta "eliminatório" e normal = false', () => {
  const parsed = parseWorkbook(buildBuffer2(), 'OPS-RED-FOR-099 - Extra.xlsx');
  const elim = parsed.questions.find((q) => q.code === '2.1.2');
  const normal = parsed.questions.find((q) => q.code === '2.1.3');
  assert.ok(elim && normal, 'ambas as questões devem existir');
  assert.equal(elim.isEliminatory, true);
  assert.equal(normal.isEliminatory, false);
});

test('parseWorkbook extrai a data da revisão quando presente', () => {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Implantação: 01/04/2023 Revisão: 02 em 28/01/2026 Classificação: Interna'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará?', 'Alvará', '10', '10'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-001 - Teste.xlsx');
  assert.equal(parsed.version, '02');
  assert.equal(parsed.revisaoDate, '2026-01-28');
});

test('parseWorkbook deixa revisaoDate null quando a planilha não traz data', () => {
  const parsed = parseWorkbook(buildBuffer(), 'OPS-RED-FOR-017 - Teste.xlsx');
  assert.equal(parsed.version, '03');
  assert.equal(parsed.revisaoDate, null);
});

test('parseWorkbook extrai a data de implantação quando presente', () => {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Implantação: 01/04/2023 Revisão: 02 em 28/01/2026 Classificação: Interna'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará?', 'Alvará', '10', '10'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-001 - Teste.xlsx');
  assert.equal(parsed.version, '02');
  assert.equal(parsed.revisaoDate, '2026-01-28');
  assert.equal(parsed.implantacaoDate, '2023-04-01');
});

test('parseWorkbook devolve version null quando não há revisão na planilha', () => {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Classificação: Interna'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará?', 'Alvará', '10', '10'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-999 - Teste.xlsx');
  assert.equal(parsed.version, null);
  assert.equal(parsed.implantacaoDate, null);
});

test('Revisão em forma de data (sem número) não vira número de revisão', () => {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-RED-FOR-024 Implantação: 30/09/2025 Revisão: 30/09/2025'],
    ['GRUPO'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará?', '', '10', '8'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-024 - Hospitais.xlsx');
  assert.equal(parsed.version, null);
  assert.equal(parsed.revisaoDate, null);
  assert.equal(parsed.implantacaoDate, '2025-09-30');
});

test('extractDocumentType — reconhece cada label da spec 5.4.2.3', () => {
  const cases: Array<[string, string, string]> = [
    ['Dispõe de alvará sanitário válido? DL', '', 'Alvará Sanitário'],
    ['Alvará de funcionamento expedido pelo órgão competente DL', '', 'Alvará de Localização'],
    ['Alvará do Corpo de Bombeiros / AVCB DL', 'Alvará ou protocolo dentro do prazo', 'Alvará dos Bombeiros'],
    ['Cadastro Nacional Estabelecimento Saúde (CNES) DL', '', 'CNES'],
    ['Dispõe de Anotação de Responsabilidade Técnica DL', '', 'ART - Anotação de Responsabilidade Técnica'],
    ['Programa de Gerenciamento de Resíduos de Serviços de Saúde - PGRSS DL', '', 'PGRSS'],
    ['Dispõe de PGR (Programa de Gerenciamento de Riscos) DL', '', 'PGR'],
    ['Dispõe de PCMSO DL', '', 'PCMSO'],
    ['Contrato Social atualizado DL', '', 'Contrato Social'],
    ['Registro de Qualificação de Especialista (RQE) DL', '', 'RQE'],
  ];
  for (const [text, guidance, expected] of cases) {
    assert.equal(extractDocumentType(text, guidance), expected, `falhou: "${text}"`);
  }
});

test('extractDocumentType — PGR não bate com PGRSS e vice-versa', () => {
  assert.equal(extractDocumentType('PGRSS aprovado', ''), 'PGRSS');
  assert.equal(extractDocumentType('PGR anual', ''), 'PGR');
});

test('extractDocumentType — sem match retorna null', () => {
  assert.equal(extractDocumentType('Critério qualquer sem palavra-chave', ''), null);
  assert.equal(extractDocumentType('Certificação genérica', ''), null);
});

test('parseWorkbook popula document_type apenas para critérios DL', () => {
  // Monta uma planilha mínima com 1 critério S e 1 DL
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Revisão: 03'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Dispõe de alvará sanitário válido? "DL"', 'Alvará dentro do prazo', '10', '10'],
    ['1.1.2 Realiza treinamento anual? "S"', 'Lista de presença', '10', '10'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-TESTE.xlsx');
  const dl = parsed.questions.find(q => q.code === '1.1.1');
  const s = parsed.questions.find(q => q.code === '1.1.2');
  assert.ok(dl && s);
  assert.equal(dl!.documentType, 'Alvará Sanitário');
  assert.equal(s!.documentType, null);
});
