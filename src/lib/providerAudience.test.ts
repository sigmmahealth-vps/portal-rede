import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerAudience } from './providerAudience.js';

test('PF cooperado = medicos', () => assert.equal(providerAudience('PF', 'MEDICOS COOPERADOS'), 'medicos'));
test('PF credenciado = medicos', () => assert.equal(providerAudience('PF', 'MEDICOS CREDENCIADOS'), 'medicos'));
test('PF outro = rede', () => assert.equal(providerAudience('PF', 'PSICOLOGOS'), 'rede'));
test('PJ = rede', () => assert.equal(providerAudience('PJ', 'CLINICAS'), 'rede'));
