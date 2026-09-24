import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNotification, dedupeKey, roteiroReminderMarco, NOTIFY_TYPES, notifyLink } from './notifyCatalog.js';
import { renderNotificationEmail } from './notifyEmail.js';

test('todos os tipos renderizam título, corpo e link', () => {
  for (const t of NOTIFY_TYPES) {
    const c = renderNotification(t, {
      cycle_label: '2026', provider_name: 'Clínica X', question_code: '1.1.4',
      seal: 'Ouro', percentual: 87.3, valid_until: '2027-08-18', items: 3,
      what: 'Treinar equipe', due_date: '2026-09-01', end_date: '2026-12-31', count: 12,
    });
    assert.ok(c.title.length > 0, t);
    assert.ok(c.body.length > 0, t);
    assert.ok(c.link.startsWith('/qualificacao'), t);
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

test('roteiro_enviado: reenvio pós-reanálise tem texto próprio', () => {
  const primeiro = renderNotification('roteiro_enviado', { provider_name: 'Clínica X' });
  const reenvio = renderNotification('roteiro_enviado', { provider_name: 'Clínica X', resubmission: true });
  assert.equal(primeiro.title, 'Roteiro enviado para análise');
  assert.equal(reenvio.title, 'Reanálise respondida — roteiro reenviado');
  assert.ok(reenvio.body.includes('reenviou'), reenvio.body);
  assert.ok(reenvio.body.includes('reanálise'), reenvio.body);
});

test('reanálise em lote: uma notificação com a lista de critérios', () => {
  const n = renderNotification('reanalise_solicitada', {
    items: [
      { code: '1.1.1', text: 'Dispõe de alvará de funcionamento válido e expedido pelo órgão competente?' },
      { code: '2.3.4', text: 'X'.repeat(200) },
    ],
    end_date: '2026-12-31',
  });
  assert.equal(n.title, 'Reanálise solicitada — 2 critérios');
  assert.ok(n.body.includes('1.1.1 — Dispõe de alvará'), n.body);
  assert.ok(!n.body.includes('X'.repeat(120)), 'texto do item deve ser truncado');
  assert.ok(n.body.includes('31/12/2026'), n.body);
});

test('reanálise em lote: lista longa é limitada a 15 itens', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ code: `1.${i}`, text: `Critério ${i}` }));
  const n = renderNotification('reanalise_solicitada', { items });
  assert.ok(n.body.includes('e mais 5 critério(s)'), n.body);
  assert.ok(!n.body.includes('Critério 19'), n.body);
});

test('ciclo_reaberto: prorrogação vs reabertura, ambos com o prazo', () => {
  const pr = renderNotification('ciclo_reaberto', { cycle_label: 'Ciclo 2026', end_date: '2026-10-15', prorrogado: true });
  assert.equal(pr.title, 'Ciclo prorrogado — Ciclo 2026');
  assert.ok(pr.body.includes('prorrogado até 15/10/2026'), pr.body);
  const re = renderNotification('ciclo_reaberto', { cycle_label: 'Ciclo 2026', end_date: '2026-10-15' });
  assert.equal(re.title, 'Ciclo Ciclo 2026 reaberto');
  assert.ok(!re.title.includes('prorrog') && re.body.includes('15/10/2026'), re.body);
  assert.equal(re.link, '/qualificacao?aba=roteiros');
});

test('ciclo_reaberto: e-mail tem banner próprio (não o tipo cru) e o prazo', () => {
  const e = renderNotificationEmail('ciclo_reaberto', { cycle_label: '2026', end_date: '2026-10-15', prorrogado: true }, 'https://x');
  assert.ok(!e.html.includes('CICLO_REABERTO'), 'banner cru');
  assert.ok(e.subject.endsWith('Ciclo prorrogado'), e.subject);
  assert.ok(e.html.includes('CICLO PRORROGADO'));
  assert.ok(e.html.includes('prorrogado até <strong>15/10/2026</strong>'), 'corpo traz a data máxima');
  // Card de dúvidas e assinatura (pedido do cliente, 2026-09-24).
  assert.ok(e.html.includes('prp@criciuma.unimedsc.com.br'));
  assert.ok(!e.html.includes('rededeprestadores@'));
  assert.ok(e.html.includes('/suporte.png'));
  assert.ok(!e.html.includes('Programa de Qualificação da Rede'));
  assert.ok(e.html.includes('/logo-unimed-email.png'));
});

test('roteiro_pendente: individual vs resumo auditoria', () => {
  const ind = renderNotification('roteiro_pendente', { end_date: '2026-12-31' });
  const dig = renderNotification('roteiro_pendente', { digest: true, count: 12, cycle_label: '2026', end_date: '2026-12-31' });
  assert.ok(ind.body.toLowerCase().includes('você'));
  assert.ok(dig.title.includes('12'));
});

test('roteiro_pendente: marcos 7 dias e fim têm textos próprios', () => {
  const m30 = renderNotification('roteiro_pendente', { end_date: '2026-12-31', marco: '30' });
  const m7 = renderNotification('roteiro_pendente', { end_date: '2026-12-31', marco: '7' });
  const fim = renderNotification('roteiro_pendente', { end_date: '2026-12-31', marco: 'fim' });
  assert.ok(m7.title.includes('7 dias'), m7.title);
  assert.ok(fim.title.toLowerCase().includes('último dia'), fim.title);
  // Três títulos distintos entre si.
  assert.equal(new Set([m30.title, m7.title, fim.title]).size, 3);
});

test('roteiroReminderMarco: janelas por dias restantes', () => {
  assert.equal(roteiroReminderMarco(40), null);   // fora da janela de 30
  assert.equal(roteiroReminderMarco(30), '30');
  assert.equal(roteiroReminderMarco(8), '30');
  assert.equal(roteiroReminderMarco(7), '7');
  assert.equal(roteiroReminderMarco(1), '7');
  assert.equal(roteiroReminderMarco(0), 'fim');    // último dia
  assert.equal(roteiroReminderMarco(-3), 'fim');   // ciclo sem auto-close já passou
});

test('ciclo_encerrado_sem_avaliacao: textos do cliente (título, corpo e próximos passos)', () => {
  const c = renderNotification('ciclo_encerrado_sem_avaliacao', { cycle_label: '2026' });
  assert.equal(c.title, 'Ciclo encerrado - Avaliação não concluída (2026)');
  assert.ok(c.body.includes('permanecerá registrada como não concluída'), c.body);
  const e = renderNotificationEmail('ciclo_encerrado_sem_avaliacao', { cycle_label: '2026' }, 'https://x');
  assert.ok(e.html.includes('CICLO ENCERRADO - AVALIAÇÃO NÃO CONCLUÍDA'));
  assert.ok(e.html.includes('não será possível concluir ou retomar esta avaliação'));
  assert.ok(!e.html.includes('aguarde a abertura do próximo ciclo'));
});

test('E-03: ciclo_aberto e reanálise mostram o prazo (fim do ciclo) quando há end_date', () => {
  const aberto = renderNotification('ciclo_aberto', { cycle_label: '2026', end_date: '2026-12-31' });
  assert.ok(aberto.body.includes('31/12/2026'), aberto.body);
  assert.ok(aberto.body.toLowerCase().includes('prazo'), aberto.body);
  const reInt = renderNotification('reanalise_solicitada', { integral: true, end_date: '2026-12-31' });
  assert.ok(reInt.body.includes('reenvio') && reInt.body.includes('31/12/2026'), reInt.body);
  const reCrit = renderNotification('reanalise_solicitada', { question_code: '1.1.2', end_date: '2026-12-31' });
  assert.ok(reCrit.body.includes('31/12/2026'), reCrit.body);
  // Sem end_date, não inventa prazo.
  const semPrazo = renderNotification('ciclo_aberto', { cycle_label: '2026' });
  assert.ok(!semPrazo.body.toLowerCase().includes('prazo'), semPrazo.body);
});

test('dedupeKey determinística', () => {
  assert.equal(dedupeKey('acao_vencendo', 'item:9', 7), 'acao_vencendo:item:9:7');
});

test('tipo desconhecido não quebra (fallback)', () => {
  const c = renderNotification('tipo_inexistente' as any, {});
  assert.equal(c.title, 'tipo_inexistente');
  assert.equal(c.link, '/qualificacao');
});

test('notifyLink: cada aviso leva à aba do destino (não à home da Qualificação)', () => {
  assert.equal(notifyLink('reanalise_solicitada', { instance_id: 42 }), '/qualificacao?aba=roteiros&corrigir=42');
  assert.equal(notifyLink('reanalise_solicitada', {}), '/qualificacao?aba=inicio');
  assert.equal(notifyLink('roteiro_enviado'), '/qualificacao?aba=painel-ciclo');
  assert.equal(notifyLink('roteiro_pendente', { digest: true }), '/qualificacao?aba=painel-ciclo');
  assert.equal(notifyLink('roteiro_pendente', {}), '/qualificacao?aba=roteiros');
  assert.equal(notifyLink('acao_aguardando_validacao'), '/qualificacao?aba=planos');
  assert.equal(notifyLink('certificado_emitido'), '/qualificacao?aba=certificados');
  assert.equal(notifyLink('tipo_inexistente'), '/qualificacao');
});

test('ciclo_aberto: menciona o manual só quando has_manual (sem linkar o arquivo)', () => {
  const com = renderNotification('ciclo_aberto', { cycle_label: '2026', has_manual: true });
  const sem = renderNotification('ciclo_aberto', { cycle_label: '2026' });
  assert.ok(com.body.includes('manual do seu roteiro'), com.body);
  assert.ok(!sem.body.includes('manual'), sem.body);
  const e = renderNotificationEmail('ciclo_aberto', { cycle_label: '2026', has_manual: true }, 'https://x');
  assert.ok(e.html.includes('manual do seu roteiro'));
  assert.ok(!e.html.includes('/manual'), 'e-mail não linka o arquivo');
});
