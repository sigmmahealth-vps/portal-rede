import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleMailer, ResendMailer, otpEmailHtml, inviteEmailHtml, resetEmailHtml, parseAllowlist, emailAllowed } from './mailer.js';

test('ConsoleMailer entrega o código pelo logger injetado', async () => {
  const linhas: string[] = [];
  const mailer = new ConsoleMailer((msg) => linhas.push(msg));
  await mailer.sendOtp('teste@exemplo.com', '123456');
  const texto = linhas.join('\n');
  assert.ok(texto.includes('teste@exemplo.com'));
  assert.ok(texto.includes('123456'));
});

test('ConsoleMailer.sendInvite logs name + link', async () => {
  const logs: string[] = [];
  const m = new ConsoleMailer((msg) => logs.push(msg));
  await m.sendInvite('user@unimed.com', 'Maria', 'https://portal/definir-senha?token=ABC');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Maria/);
  assert.match(logs[0], /https:\/\/portal\/definir-senha\?token=ABC/);
});

test('ConsoleMailer.sendPasswordReset logs link', async () => {
  const logs: string[] = [];
  const m = new ConsoleMailer((msg) => logs.push(msg));
  await m.sendPasswordReset('user@unimed.com', 'https://portal/definir-senha?token=XYZ');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /https:\/\/portal\/definir-senha\?token=XYZ/);
});

test('ConsoleMailer.sendNotification loga destinatário e assunto', async () => {
  const logs: string[] = [];
  const m = new ConsoleMailer((msg) => logs.push(msg));
  await m.sendNotification('x@y.com', 'Portal Unimed — Teste', 'corpo');
  assert.ok(logs[0].includes('x@y.com'));
  assert.ok(logs[0].includes('Portal Unimed — Teste'));
});

test('e-mails de auth em HTML no padrão da marca', () => {
  const otp = otpEmailHtml('123456');
  assert.ok(otp.includes('123456'));
  assert.ok(otp.includes('CÓDIGO DE ACESSO AO PORTAL'));
  const invite = inviteEmailHtml('Fulano', 'https://x/definir-senha?token=abc');
  assert.ok(invite.includes('Olá, <strong>Fulano</strong>'));
  assert.ok(invite.includes('https://x/definir-senha?token=abc'));
  const reset = resetEmailHtml('https://x/definir-senha?token=r');
  assert.ok(reset.includes('REDEFINIÇÃO DE SENHA'));
  assert.ok(reset.includes('Cooperativa de Trabalho Médico'));
});

test('sendNotification devolve o desfecho: ConsoleMailer suprime, Resend suprime fora da allowlist', async () => {
  // ConsoleMailer nunca envia de verdade → 'suppressed'.
  const cm = new ConsoleMailer(() => {});
  assert.equal(await cm.sendNotification('x@y.com', 'assunto', 'corpo'), 'suppressed');
  // ResendMailer com allowlist que NÃO casa o destinatário → 'suppressed' sem tocar a rede
  // (a supressão retorna antes de chamar o cliente Resend).
  const rm = new ResendMailer('re_dummy', 'Portal <no@reply.com>', ['@sigmma.health']);
  assert.equal(await rm.sendNotification('clinica-real@terra.com.br', 'assunto', 'corpo'), 'suppressed');
});

test('allowlist por sufixo: padrão homolog, domínio e exato; vazia libera tudo', () => {
  const list = parseAllowlist(' homolog@hotmail.com, @sigmma.health ');
  assert.deepEqual(list, ['homolog@hotmail.com', '@sigmma.health']);
  assert.equal(emailAllowed('ADM-Homolog@hotmail.com', list), true);
  assert.equal(emailAllowed('prestador-homolog@hotmail.com', list), true);
  assert.equal(emailAllowed('katy.garcia@sigmma.health', list), true);
  assert.equal(emailAllowed('clinica-real@terra.com.br', list), false);
  assert.equal(emailAllowed('outro@hotmail.com', list), false);
  assert.equal(emailAllowed('qualquer@um.com', []), true);
  assert.equal(emailAllowed('x@sigmma.health.evil.com', list), false);
});
