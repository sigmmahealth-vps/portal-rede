import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNotification, dedupeKey, NOTIFY_TYPES } from './notifyCatalog.js';

test('todos os tipos renderizam título, corpo e link', () => {
  for (const t of NOTIFY_TYPES) {
    const c = renderNotification(t, {
      cycle_label: '2026', provider_name: 'Clínica X', question_code: '1.1.4',
      seal: 'Ouro', percentual: 87.3, valid_until: '2027-08-18', items: 3,
      what: 'Treinar equipe', due_date: '2026-09-01', end_date: '2026-12-31', count: 12,
    });
    assert.ok(c.title.length > 0, t);
    assert.ok(c.body.length > 0, t);
    assert.equal(c.link, '/qualificacao', t);
  }
});

test('datas em formato pt-BR', () => {
  const c = renderNotification('certificado_vencendo', { valid_until: '2027-08-18' });
  assert.ok(c.body.includes('18/08/2027'), c.body);
});

test('reanálise: integral vs por critério', () => {
  const integral = renderNotification('reanalise_solicitada', { integral: true });
  const criterio = renderNotification('reanalise_solicitada', { question_code: '1.1.4' });
  assert.ok(integral.title.includes('devolvida'));
  assert.ok(criterio.title.includes('1.1.4'));
});

test('roteiro_pendente: individual vs resumo auditoria', () => {
  const ind = renderNotification('roteiro_pendente', { end_date: '2026-12-31' });
  const dig = renderNotification('roteiro_pendente', { digest: true, count: 12, cycle_label: '2026', end_date: '2026-12-31' });
  assert.ok(ind.body.toLowerCase().includes('você'));
  assert.ok(dig.title.includes('12'));
});

test('dedupeKey determinística', () => {
  assert.equal(dedupeKey('acao_vencendo', 'item:9', 7), 'acao_vencendo:item:9:7');
});

test('tipo desconhecido não quebra (fallback)', () => {
  const c = renderNotification('tipo_inexistente' as any, {});
  assert.equal(c.title, 'tipo_inexistente');
  assert.equal(c.link, '/qualificacao');
});
