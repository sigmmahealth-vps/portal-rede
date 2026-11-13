import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusDocumento } from './documentoStatus.js';

const hoje = new Date(2026, 10, 13);
test('pendente', () => assert.equal(statusDocumento({ status: 'pendente', expiry_date: null }, hoje), 'pendente'));
test('reprovado', () => assert.equal(statusDocumento({ status: 'reprovado', expiry_date: null }, hoje), 'reprovado'));
test('historico some', () => assert.equal(statusDocumento({ status: 'historico', expiry_date: null }, hoje), 'historico'));
test('valido sem validade = aprovado', () => assert.equal(statusDocumento({ status: 'valido', expiry_date: null }, hoje), 'aprovado'));
test('valido validade futura = aprovado', () => assert.equal(statusDocumento({ status: 'valido', expiry_date: '2027-01-01' }, hoje), 'aprovado'));
test('valido validade passada = vencido', () => assert.equal(statusDocumento({ status: 'valido', expiry_date: '2026-01-01' }, hoje), 'vencido'));
test('vencido explícito', () => assert.equal(statusDocumento({ status: 'vencido', expiry_date: '2026-01-01' }, hoje), 'vencido'));
test('validade == hoje ainda é aprovado', () => assert.equal(statusDocumento({ status: 'valido', expiry_date: '2026-11-13' }, hoje), 'aprovado'));
