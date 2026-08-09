// src/lib/actionPlan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWindows, computePlanStatus, planColor, buildAutoItems,
  DUE_SOON_DAYS,
} from './actionPlan.js';

const D = (s: string) => new Date(s + 'T12:00:00Z');

test('computeWindows: 3 janelas a +90/+180/+270 dias da criação', () => {
  const w = computeWindows(D('2026-10-15'));
  assert.equal(w.length, 3);
  assert.equal(w[0].toISOString().slice(0, 10), '2027-01-13');
  assert.equal(w[1].toISOString().slice(0, 10), '2027-04-13');
  assert.equal(w[2].toISOString().slice(0, 10), '2027-07-12');
});

test('computePlanStatus: plano sem interação e sem itens ativos = aberto', () => {
  const s = computePlanStatus({
    items: [{ status: 'nao_iniciada', due_date: '2027-06-01' }],
    hasProviderInteraction: false,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'aberto');
});

test('computePlanStatus: item aguardando_revisao domina', () => {
  const s = computePlanStatus({
    items: [
      { status: 'concluida', due_date: '2027-01-01' },
      { status: 'aguardando_revisao', due_date: '2027-06-01' },
    ],
    hasProviderInteraction: true,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'aguardando_revisao');
});

test('computePlanStatus: prazo expirado com item aberto = atrasado', () => {
  const s = computePlanStatus({
    items: [{ status: 'em_andamento', due_date: '2026-10-01' }],
    hasProviderInteraction: true,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'atrasado');
});

test(`computePlanStatus: a menos de ${DUE_SOON_DAYS} dias do prazo = a_vencer`, () => {
  const s = computePlanStatus({
    items: [{ status: 'em_andamento', due_date: '2026-11-10' }],
    hasProviderInteraction: true,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'a_vencer');
});

test('computePlanStatus: todas concluídas = concluido; encerrado domina tudo', () => {
  const base = {
    items: [{ status: 'concluida', due_date: '2026-10-01' }],
    hasProviderInteraction: true, now: D('2026-11-01'),
  };
  assert.equal(computePlanStatus({ ...base, closedWithoutCompletion: false }), 'concluido');
  assert.equal(computePlanStatus({ ...base, closedWithoutCompletion: true }), 'encerrado_sem_conclusao');
});

test('computePlanStatus: atrasado vence aguardando_revisao quando coexistem', () => {
  const s = computePlanStatus({
    items: [
      { status: 'em_andamento', due_date: '2026-10-01' },      // vencido
      { status: 'aguardando_revisao', due_date: '2027-06-01' },
    ],
    hasProviderInteraction: true,
    closedWithoutCompletion: false,
    now: D('2026-11-01'),
  });
  assert.equal(s, 'atrasado');
});

test('planColor: mapeamento 5.4.4.5', () => {
  assert.equal(planColor('em_andamento'), 'verde');
  assert.equal(planColor('aberto'), 'azul');
  assert.equal(planColor('aguardando_revisao'), 'azul');
  assert.equal(planColor('a_vencer'), 'laranja');
  assert.equal(planColor('atrasado'), 'vermelho');
});

test('buildAutoItems: reprovados viram itens; DL é obrigatório', () => {
  const answers = [
    { id: 1, question_code: 'DL-01', question_text: 'Alvará sanitário vigente',
      legislation: 'RDC 63/2011', dimension: 'Documento Legal',
      is_non_compliant: true, evidence_status: 'reprovado', guidance: 'Anexar alvará' },
    { id: 2, question_code: 'S-04', question_text: 'Rotas de fuga sinalizadas',
      legislation: 'RDC 50/2002', dimension: 'Segurança',
      is_non_compliant: true, evidence_status: 'reprovado', guidance: null },
    { id: 3, question_code: 'C-02', question_text: 'Sala de espera climatizada',
      legislation: null, dimension: 'Conforto',
      is_non_compliant: false, evidence_status: 'aprovado', guidance: null },
  ];
  const items = buildAutoItems(answers, { segurancaPct: 72 });
  assert.equal(items.length, 2); // só os não conformes
  const dl = items.find(i => i.question_code === 'DL-01')!;
  assert.equal(dl.is_mandatory, true);
  assert.match(dl.why, /RDC 63\/2011/);
  const seg = items.find(i => i.question_code === 'S-04')!;
  assert.equal(seg.is_mandatory, false); // Segurança >= 60%
});

test('buildAutoItems: Segurança < 60% torna itens de Segurança obrigatórios', () => {
  const answers = [
    { id: 2, question_code: 'S-04', question_text: 'Rotas de fuga sinalizadas',
      legislation: 'RDC 50/2002', dimension: 'Segurança',
      is_non_compliant: true, evidence_status: 'reprovado', guidance: null },
  ];
  const items = buildAutoItems(answers, { segurancaPct: 45 });
  assert.equal(items[0].is_mandatory, true);
});

test('buildAutoItems: coage answer_id string (bigint do pg) para number', () => {
  const items = buildAutoItems([
    { id: '7' as any, question_code: 'S-01', question_text: 'X',
      legislation: null, dimension: 'Segurança',
      is_non_compliant: true, evidence_status: null, guidance: null },
  ], { segurancaPct: 100 });
  assert.equal(items[0].answer_id, 7);
});
