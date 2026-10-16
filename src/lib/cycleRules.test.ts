import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parecerBlock, validityVsEndError } from './cycleRules.ts';

const hoje = '2026-10-16';
const ok = { active: true, end_date: '2026-11-04', cert_valid_until: '2026-12-31' };

test('parecer: ciclo ativo, no prazo e com validade futura → libera', () => {
  assert.equal(parecerBlock(ok, hoje), null);
  assert.equal(parecerBlock({ ...ok, end_date: hoje, cert_valid_until: hoje }, hoje), null); // último dia vale
});

test('parecer: ciclo encerrado bloqueia', () => {
  assert.match(parecerBlock({ ...ok, active: false }, hoje)!, /Ciclo encerrado/);
});

test('parecer: fim do ciclo no passado bloqueia e orienta prorrogar', () => {
  assert.match(parecerBlock({ ...ok, end_date: '2026-10-15' }, hoje)!, /terminou em 15\/10\/2026.*prorrogar/);
});

test('parecer: validade vencida ou ausente bloqueia', () => {
  assert.match(parecerBlock({ ...ok, end_date: '2026-10-20', cert_valid_until: '2026-10-09' }, hoje)!, /09\/10\/2026.*nasceria vencido/);
  assert.match(parecerBlock({ ...ok, cert_valid_until: null }, hoje)!, /sem data de validade/);
});

test('validade ≥ fim do ciclo', () => {
  assert.equal(validityVsEndError('2026-11-04', '2026-11-04'), null);
  assert.equal(validityVsEndError('2026-11-04', '2026-12-31'), null);
  assert.equal(validityVsEndError(null, '2026-12-31'), null);
  assert.match(validityVsEndError('2026-11-04', '2026-10-09')!, /não pode ser anterior ao fim do ciclo \(04\/11\/2026\)/);
  assert.match(validityVsEndError('2027-01-10', '2026-12-31', true)!, /já está travada/);
});
