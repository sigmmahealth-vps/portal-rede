import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmailHtml, renderNotificationEmail } from './notifyEmail.js';
import { NOTIFY_TYPES } from './notifyCatalog.js';

const CTX = {
  cycle_label: '2026', provider_name: 'Clínica X', question_code: '1.1.4',
  seal: 'Ouro', percentual: 87.3, valid_until: '2027-08-18', items: 3,
  what: 'Treinar equipe', due_date: '2026-09-01', end_date: '2026-12-31', count: 12,
};
const APP = 'https://portal.exemplo.com.br';

test('todos os tipos com canal e-mail renderizam subject e html no padrão', () => {
  for (const t of NOTIFY_TYPES) {
    const e = renderNotificationEmail(t, CTX, APP, 'Fulano');
    assert.ok(e.subject.length > 0, t);
    assert.ok(e.html.includes('Rede de Prestadores'), t);            // cabeçalho
    assert.ok(e.html.includes('Olá, <strong>Fulano</strong>'), t);   // saudação
    assert.ok(e.html.includes(`${APP}/qualificacao`), t);            // CTA
    assert.ok(e.html.includes('Cooperativa de Trabalho Médico'), t); // rodapé
  }
});

test('conteúdo escapa HTML vindo do contexto', () => {
  const e = renderNotificationEmail('acao_vencendo', { ...CTX, what: '<script>x</script>' }, APP);
  assert.ok(!e.html.includes('<script>'));
  assert.ok(e.html.includes('&lt;script&gt;'));
});

test('destaques por tipo: datas pt-BR e valores', () => {
  const cert = renderNotificationEmail('certificado_vencendo', CTX, APP);
  assert.ok(cert.html.includes('18/08/2027'));
  const parecer = renderNotificationEmail('parecer_aprovado', CTX, APP);
  assert.ok(parecer.html.includes('Ouro'));
  const digest = renderNotificationEmail('roteiro_pendente', { ...CTX, digest: true }, APP);
  assert.ok(digest.html.includes('12'));
});

test('renderEmailHtml genérico (retry) leva faixa, corpo e CTA', () => {
  const html = renderEmailHtml({
    banner: 'Título qualquer',
    paragraphs: ['Corpo da mensagem.'],
    cta: { label: 'Acessar o portal', url: `${APP}/qualificacao` },
  }, APP);
  assert.ok(html.includes('TÍTULO QUALQUER'));
  assert.ok(html.includes('Corpo da mensagem.'));
  assert.ok(html.includes(`${APP}/qualificacao`));
});

test('ícones do card de destaque por tipo', () => {
  assert.ok(renderNotificationEmail('parecer_aprovado', { ...CTX, seal: 'Ouro' }, APP).html.includes('🥇'));
  assert.ok(renderNotificationEmail('parecer_aprovado', { ...CTX, seal: 'Prata' }, APP).html.includes('🥈'));
  assert.ok(renderNotificationEmail('parecer_aprovado', { ...CTX, seal: 'Bronze' }, APP).html.includes('🥉'));
  for (const t of ['certificado_emitido', 'certificado_vencendo', 'acao_vencendo', 'acao_atrasada', 'roteiro_pendente'] as const) {
    assert.ok(renderNotificationEmail(t, CTX, APP).html.includes('📅'), t);
  }
  assert.ok(renderNotificationEmail('roteiro_pendente', { ...CTX, digest: true }, APP).html.includes('📅'));
  assert.ok(renderNotificationEmail('plano_gerado', CTX, APP).html.includes('📋'));
  assert.ok(renderNotificationEmail('reanalise_solicitada', CTX, APP).html.includes('✉️')); // default preservado
});

test('saudação ausente sem nome do destinatário', () => {
  const e = renderNotificationEmail('ciclo_aberto', CTX, APP);
  assert.ok(e.html.includes('Olá.'));
});
