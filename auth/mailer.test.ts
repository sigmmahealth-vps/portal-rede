import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleMailer } from './mailer.js';

test('ConsoleMailer entrega o código pelo logger injetado', async () => {
  const linhas: string[] = [];
  const mailer = new ConsoleMailer((msg) => linhas.push(msg));
  await mailer.sendOtp('teste@exemplo.com', '123456');
  const texto = linhas.join('\n');
  assert.ok(texto.includes('teste@exemplo.com'));
  assert.ok(texto.includes('123456'));
});
