import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TERMO_EVIDENCIAS_VERSION, TERMO_EVIDENCIAS_TITULO, TERMO_EVIDENCIAS_PARAGRAFOS,
  TERMO_EVIDENCIAS_DECLARACAO, termoEvidenciasTexto,
} from './termoEvidencias.ts';

test('versão definida', () => {
  assert.equal(TERMO_EVIDENCIAS_VERSION, '2026-09-29');
});

test('snapshot contém título, todos os parágrafos e a declaração', () => {
  const t = termoEvidenciasTexto();
  assert.ok(t.startsWith(TERMO_EVIDENCIAS_TITULO));
  assert.equal(TERMO_EVIDENCIAS_PARAGRAFOS.length, 7);
  for (const p of TERMO_EVIDENCIAS_PARAGRAFOS) assert.ok(t.includes(p));
  assert.ok(t.endsWith(TERMO_EVIDENCIAS_DECLARACAO));
});
