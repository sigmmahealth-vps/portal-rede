import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAcceptedDocFormat, DOC_MAX_BYTES, DOC_ACCEPTED_EXT } from './documentTypeRules.js';

test('aceita PDF/JPG/JPEG/PNG/DOCX em qualquer caixa', () => {
  for (const f of ['a.pdf', 'b.JPG', 'c.jpeg', 'd.PNG', 'e.docx', 'nota fiscal.PDF']) {
    assert.equal(isAcceptedDocFormat(f), true, f);
  }
});

test('recusa outros formatos', () => {
  for (const f of ['a.exe', 'b.zip', 'c.doc', 'd.svg', 'sem-extensao', 'e.pdf.exe']) {
    assert.equal(isAcceptedDocFormat(f), false, f);
  }
});

test('constantes expostas', () => {
  assert.equal(DOC_MAX_BYTES, 20 * 1024 * 1024);
  assert.deepEqual([...DOC_ACCEPTED_EXT], ['pdf', 'jpg', 'jpeg', 'png', 'docx']);
});
