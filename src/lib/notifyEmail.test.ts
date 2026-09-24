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
    assert.ok(e.html.includes(`${APP}/logo-prp-branco.png`), t);     // cabeçalho PRP
    assert.ok(e.html.includes("'Unimed Sans'"), t);                  // fonte da marca
    assert.ok(e.html.includes(`${APP}/fonts/Unimed-Regular.woff2`), t);
    assert.ok(e.html.includes('Olá, <strong>Fulano</strong>'), t);   // saudação
    assert.ok(e.html.includes(`${APP}/qualificacao`), t);            // CTA
    assert.ok(e.html.includes('Cooperativa de Trabalho Médico'), t); // rodapé
    assert.ok(e.html.includes(`${APP}/logo-unimed-email.png`), t);   // logo do rodapé (alta resolução)
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

test('roteiro_enviado: e-mail do reenvio pós-reanálise tem banner e passos próprios', () => {
  const e = renderNotificationEmail('roteiro_enviado', { provider_name: 'Clínica X', resubmission: true }, APP);
  assert.ok(e.subject.includes('Reanálise respondida'), e.subject);
  assert.ok(e.html.includes('reenviou'), 'corpo menciona reenvio');
  assert.ok(e.html.toLowerCase().includes('critérios devolvidos'), 'passos apontam os devolvidos');
});

test('reanálise em lote: e-mail lista código e descrição de cada critério', () => {
  const e = renderNotificationEmail('reanalise_solicitada', {
    items: [
      { code: '1.1.1', text: 'Dispõe de alvará de funcionamento válido?' },
      { code: '3.2.2', text: 'Y'.repeat(200) },
    ],
    end_date: '2026-09-18',
  }, APP);
  assert.ok(e.subject.includes('2 critérios'), e.subject);
  assert.ok(e.html.includes('<strong>1.1.1</strong>'), 'código em negrito');
  assert.ok(e.html.includes('Dispõe de alvará de funcionamento válido?'));
  assert.ok(!e.html.includes('Y'.repeat(120)), 'texto do item truncado');
  assert.ok(e.html.includes('18/09/2026'), 'prazo no destaque');
});

test('reanálise em lote: lista longa limitada a 15 no e-mail', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ code: `1.${i}`, text: `Critério ${i}` }));
  const e = renderNotificationEmail('reanalise_solicitada', { items }, APP);
  assert.ok(e.html.includes('e mais 5 critério(s)'), 'resto indicado');
  assert.ok(!e.html.includes('Critério 19'));
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
  assert.ok(renderNotificationEmail('parecer_aprovado', { ...CTX, seal: 'Ouro' }, APP).html.includes(`${APP}/selos/ouro.png`));
  assert.ok(renderNotificationEmail('parecer_aprovado', { ...CTX, seal: 'Prata' }, APP).html.includes(`${APP}/selos/prata.png`));
  assert.ok(renderNotificationEmail('parecer_aprovado', { ...CTX, seal: 'Bronze' }, APP).html.includes(`${APP}/selos/bronze.png`));
  const semArte = renderNotificationEmail('parecer_aprovado', { ...CTX, seal: 'Diamante' }, APP).html; // selo sem arte → card sem medalha
  assert.ok(semArte.includes('Selo Diamante') && !semArte.includes('/selos/'));
  for (const t of ['certificado_emitido', 'certificado_vencendo', 'acao_vencendo', 'acao_atrasada', 'roteiro_pendente'] as const) {
    assert.ok(renderNotificationEmail(t, CTX, APP).html.includes(`${APP}/calendario.png`), t);
  }
  assert.ok(renderNotificationEmail('roteiro_pendente', { ...CTX, digest: true }, APP).html.includes(`${APP}/calendario.png`));
});

test('cards removidos na rodada de aprovação: reanálise e plano sem destaque', () => {
  assert.ok(!renderNotificationEmail('reanalise_solicitada', CTX, APP).html.includes('CRITÉRIO EM REANÁLISE'));
  assert.ok(!renderNotificationEmail('plano_gerado', CTX, APP).html.includes('AÇÕES DO PLANO'));
});

test('saudação ausente sem nome do destinatário', () => {
  const e = renderNotificationEmail('ciclo_aberto', CTX, APP);
  assert.ok(e.html.includes('Olá.'));
});

test('parecer_aprovado: card de resultado, título e botão do cliente', () => {
  const e = renderNotificationEmail('parecer_aprovado', { seal: 'Ouro', percentual: 92.2, has_certificate: true, valid_until: '2027-03-15' }, APP, 'GUILHERME');
  assert.ok(e.html.includes('RESULTADO DA SUA QUALIFICAÇÃO'));
  assert.ok(e.html.includes('Confira abaixo o resultado da sua avaliação.'));
  assert.ok(e.html.includes('92,2%') && e.html.includes('de atingimento') && e.html.includes('Selo Ouro'));
  assert.ok(e.html.includes('Aprovado') && e.html.includes('Disponível no portal') && e.html.includes('15/03/2027'));
  assert.ok(e.html.includes('Acessar meu resultado'));
  // Sem certificado emitido, não promete certificado nem validade.
  const semCert = renderNotificationEmail('parecer_aprovado', { seal: 'Ouro', percentual: 92.2 }, APP).html;
  assert.ok(!semCert.includes('Disponível no portal') && !semCert.includes('VALIDADE'));
});

test('certificado_emitido: chamada para o próximo ciclo e botão "Acessar certificado"', () => {
  const e = renderNotificationEmail('certificado_emitido', { valid_until: '2026-10-10' }, APP, 'GUILHERME');
  assert.ok(e.html.includes('Parabéns por esta conquista! Nos encontramos novamente no próximo ciclo de qualificação.'));
  assert.ok(e.html.includes('Acessar certificado') && !e.html.includes('Acessar o portal'));
  assert.ok(e.html.includes(`${APP}/qualificacao?aba=certificados`));
  assert.ok(e.html.includes('10/10/2026'));
});

test('plano_gerado: prestador recebe texto/botão do cliente; auditoria segue genérica', () => {
  const p = renderNotificationEmail('plano_gerado', { provider_name: 'GUILHERME', audience: 'prestador' }, APP, 'GUILHERME');
  assert.ok(p.html.includes('SEU PLANO DE AÇÃO ESTÁ DISPONÍVEL'));
  assert.ok(p.html.includes('Sua qualificação ainda tem próximos passos'));
  assert.ok(p.html.includes('Acessar Plano de Ação') && p.html.includes(`${APP}/qualificacao?aba=planos`));
  const a = renderNotificationEmail('plano_gerado', { provider_name: 'GUILHERME' }, APP, 'Auditoria');
  assert.ok(a.html.includes('PLANO DE AÇÃO GERADO') && a.html.includes('<strong>GUILHERME</strong>'));
  assert.ok(!a.html.includes('Sua qualificação ainda tem próximos passos'));
});

test('certificado_vencendo: texto do cliente com a validade e chamada para o próximo ciclo', () => {
  const e = renderNotificationEmail('certificado_vencendo', { valid_until: '2026-10-10' }, APP, 'GUILHERME');
  assert.ok(e.html.includes('é válido até <strong>10/10/2026</strong>. O próximo ciclo está chegando!'));
  assert.ok(e.html.includes('manter suas documentações e evidências atualizadas'));
  assert.ok(e.html.includes('Olá, <strong>GUILHERME</strong>'));
});

test('reanalise_solicitada: botão "Preencher reanálise" nas três variantes', () => {
  for (const ctx of [{ items: [{ code: '1.1.5', text: 'CNES' }], instance_id: 9 }, { integral: true }, { question_code: '1.1.4' }]) {
    const h = renderNotificationEmail('reanalise_solicitada', ctx, APP, 'GUILHERME').html;
    assert.ok(h.includes('Preencher reanálise') && !h.includes('Acessar o portal'), JSON.stringify(ctx));
  }
});
