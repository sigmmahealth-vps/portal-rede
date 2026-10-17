import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirCopia } from './sgu-raw-copia.ts';

const f = { carga: '2026-10-16 23:01:00.336101', linhas: 2322 };

test('copia quando a fonte tem carga mais nova', () => {
  assert.equal(decidirCopia(f, { carga: '2026-10-13 15:36:12.203228', linhas: 2012 }).copiar, true);
  assert.equal(decidirCopia(f, { carga: null, linhas: 0 }).copiar, true); // destino vazio
});

test('não copia com o destino em dia ou mais novo', () => {
  assert.equal(decidirCopia(f, { ...f }).copiar, false);
  assert.equal(decidirCopia(f, { carga: '2026-10-17 23:00:00', linhas: 2300 }).copiar, false);
});

test('não copia fonte vazia nem carga suspeita (menos da metade das linhas)', () => {
  assert.equal(decidirCopia({ carga: null, linhas: 0 }, { carga: null, linhas: 0 }).copiar, false);
  const r = decidirCopia({ carga: f.carga, linhas: 900 }, { carga: '2026-10-13 15:36:12', linhas: 2012 });
  assert.equal(r.copiar, false);
  assert.match(r.motivo, /suspeita/);
});
