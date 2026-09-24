import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDownloadManual, isPdf } from './script-manual.js';

test('canDownloadManual: staff baixa qualquer; prestador só o próprio roteiro', () => {
  assert.equal(canDownloadManual('admin', [], 'FOR-015.xlsx'), true);
  assert.equal(canDownloadManual('auditoria', [], 'FOR-015.xlsx'), true);
  assert.equal(canDownloadManual('credenciado', ['FOR-015.xlsx'], 'FOR-015.xlsx'), true);
  assert.equal(canDownloadManual('prestador', ['FOR-004.xlsx'], 'FOR-015.xlsx'), false);
  assert.equal(canDownloadManual('cooperado', [], 'FOR-015.xlsx'), false);
  assert.equal(canDownloadManual('prestador', ['FOR-015.xlsx'], null), false);
  assert.equal(canDownloadManual('outro', ['FOR-015.xlsx'], 'FOR-015.xlsx'), false);
});

test('isPdf: exige extensão e assinatura %PDF', () => {
  assert.equal(isPdf('m.pdf', Buffer.from('%PDF-1.7 ...')), true);
  assert.equal(isPdf('M.PDF', Buffer.from('%PDF-1.4')), true);
  assert.equal(isPdf('m.pdf', Buffer.from('PK\x03\x04')), false);
  assert.equal(isPdf('m.docx', Buffer.from('%PDF-1.7')), false);
});
