import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeEmail, fakeCnpj, fakeCpf, fakePhone, fakeCep, assertNaoProducao,
} from './anonimiza-lib.js';

test('fakes são determinísticos e únicos por id', () => {
  assert.equal(fakeEmail(7), fakeEmail(7));
  assert.notEqual(fakeEmail(7), fakeEmail(8));
  assert.ok(fakeEmail(7).endsWith('@exemplo.invalid'));
});

test('cnpj/cpf têm o comprimento certo e não colidem', () => {
  assert.equal(fakeCnpj(1).length, 14);
  assert.equal(fakeCpf(1).length, 11);
  assert.notEqual(fakeCnpj(1), fakeCnpj(2));
  assert.notEqual(fakeCpf(1), fakeCpf(2));
});

test('phone/cep só com dígitos', () => {
  assert.match(fakePhone(42), /^\d{11}$/);
  assert.match(fakeCep(42), /^\d{8}$/);
});

test('trava recusa quando o alvo é o banco de produção', () => {
  const prod = 'postgres://user:pw@prod-host:5432/railway';
  const mesmaProd = 'postgres://OUTRO:senha@prod-host:5432/railway'; // credencial diferente, mesmo host+db
  assert.throws(() => assertNaoProducao(mesmaProd, prod), /PRODUÇÃO/);
});

test('trava passa quando o alvo é outro banco', () => {
  const prod = 'postgres://user:pw@prod-host:5432/railway';
  const dev = 'postgres://user:pw@dev-host:5432/railway';
  assert.doesNotThrow(() => assertNaoProducao(dev, prod));
  assert.doesNotThrow(() => assertNaoProducao(dev, undefined));
});

test('trava recusa alvo vazio', () => {
  assert.throws(() => assertNaoProducao(undefined, undefined), /alvo/);
});
