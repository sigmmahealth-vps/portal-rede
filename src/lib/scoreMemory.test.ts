import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreMemory, type ScoreMemoryRow } from './scoreMemory.js';

function row(over: Partial<ScoreMemoryRow> = {}): ScoreMemoryRow {
  return {
    question_id: over.question_id ?? 1,
    code: over.code ?? 'X',
    dimension: over.dimension ?? 'Conforto',
    is_eliminatory: over.is_eliminatory ?? false,
    max_score: over.max_score ?? 10,
    answer_value: over.answer_value !== undefined ? over.answer_value : 'sim',
    score_obtained: over.score_obtained !== undefined ? over.score_obtained : 10,
    evidence_status: over.evidence_status ?? 'aprovado',
  };
}

test('sim/aprovado conta pontos; nao/aprovado conta 0; ambos no denominador', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', answer_value: 'sim', score_obtained: 10, max_score: 10 }),
    row({ question_id: 2, code: 'B', answer_value: 'nao', score_obtained: 0, max_score: 10 }),
  ], null);
  assert.equal(m.totals.obtained, 10);
  assert.equal(m.totals.max, 20);
  assert.equal(m.totals.base_pct, 50);
});

test('N/A aprovado sai do calculo; N/A reprovado conta 0 no denominador', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', answer_value: 'sim', score_obtained: 10, max_score: 10 }),
    row({ question_id: 2, code: 'NAOK', answer_value: 'na', evidence_status: 'aprovado', score_obtained: 0, max_score: 10 }),
    row({ question_id: 3, code: 'NAREP', answer_value: 'na', evidence_status: 'reprovado', score_obtained: 0, max_score: 10 }),
  ], null);
  assert.equal(m.totals.max, 20);            // 10 (A) + 10 (NAREP); NAOK fora
  assert.equal(m.totals.obtained, 10);
  assert.deepEqual(m.out_of_calc.na_aprovado, ['NAOK']);
  assert.equal(m.criteria.find(c => c.code === 'NAREP')!.classification, 'conta');
});

test('sem resposta (answer_value nulo) sai do calculo e aparece em out_of_calc', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', answer_value: 'sim', score_obtained: 8, max_score: 10 }),
    row({ question_id: 2, code: 'VAZIO', answer_value: null, score_obtained: null, max_score: 10 }),
  ], null);
  assert.equal(m.totals.max, 10);
  assert.deepEqual(m.out_of_calc.sem_resposta, ['VAZIO']);
});

test('Documento Legal consolida em Seguranca', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'S1', dimension: 'Segurança', score_obtained: 5, max_score: 10 }),
    row({ question_id: 2, code: 'DL1', dimension: 'Documento Legal', score_obtained: 10, max_score: 10 }),
  ], null);
  const seg = m.dimensions.find(d => d.dimension === 'Segurança')!;
  assert.equal(seg.obtained, 15);
  assert.equal(seg.max, 20);
  assert.equal(m.dimensions.some(d => d.dimension === 'Documento Legal'), false);
  // A classe crua é preservada por critério mesmo consolidando o subtotal.
  const dl = m.criteria.find(c => c.code === 'DL1')!;
  assert.equal(dl.dimension, 'Segurança');       // consolidada p/ agrupar
  assert.equal(dl.classe, 'Documento Legal');    // crua p/ exibir
});

test('bonus +10 no prazo, teto 100, e seal via computeSeal', () => {
  const rows = [row({ question_id: 1, code: 'A', score_obtained: 10, max_score: 10 })]; // base 100
  const semBonus = buildScoreMemory(rows, { within_deadline: false });
  assert.equal(semBonus.bonus, 0);
  assert.equal(semBonus.final_pct, 100);
  assert.equal(semBonus.seal, 'Ouro');
  const comBonus = buildScoreMemory(rows, { within_deadline: true });
  assert.equal(comBonus.final_pct, 100);      // teto 100 ((10+10)/10 -> 200 -> 100)
  const semSurvey = buildScoreMemory(rows, null);
  assert.equal(semSurvey.bonus_pending, true);
});

test('bonus soma no numerador, nao em pontos percentuais: 180/200 +10 = 95%', () => {
  const rows = [row({ question_id: 1, code: 'A', score_obtained: 180, max_score: 200 })];
  const com = buildScoreMemory(rows, { within_deadline: true });
  assert.equal(com.totals.base_pct, 90);
  assert.equal(com.bonus, 10);
  assert.equal(com.final_pct, 95);            // (180+10)/200 = 95, NAO 90+10 = 100
  const sem = buildScoreMemory(rows, { within_deadline: false });
  assert.equal(sem.final_pct, 90);
});

test('eliminatorio reprovado rebaixa selo a Bronze', () => {
  const m = buildScoreMemory([
    row({ question_id: 1, code: 'A', score_obtained: 10, max_score: 10 }),
    row({ question_id: 2, code: 'ELIM', is_eliminatory: true, answer_value: 'nao', evidence_status: 'reprovado', score_obtained: 0, max_score: 10 }),
  ], { within_deadline: false });
  assert.equal(m.eliminatory_failed, true);
  assert.equal(m.seal, 'Bronze');
});

test('paridade com a formula do parecer (base/final/seal)', () => {
  const rows: ScoreMemoryRow[] = [
    row({ question_id: 1, code: 'A', dimension: 'Segurança', score_obtained: 7, max_score: 10 }),
    row({ question_id: 2, code: 'B', dimension: 'Conforto', answer_value: 'nao', score_obtained: 0, max_score: 10 }),
    row({ question_id: 3, code: 'C', dimension: 'Experiência do Cliente', score_obtained: 9, max_score: 10 }),
    row({ question_id: 4, code: 'D', answer_value: 'na', evidence_status: 'aprovado', score_obtained: 0, max_score: 10 }),
  ];
  const survey = { within_deadline: true };
  // Referencia = formula atual do /parecer.
  const counted = rows.filter(r => !(String(r.answer_value).toLowerCase() === 'na' && r.evidence_status === 'aprovado') && r.answer_value);
  const score = counted.reduce((s, r) => s + (r.score_obtained ?? 0), 0);
  const max = counted.reduce((s, r) => s + r.max_score, 0);
  const base = max > 0 ? Math.round((score / max) * 10000) / 100 : 0;
  const bonus = survey.within_deadline ? 10 : 0;
  const final = max > 0 ? Math.min(100, Math.round(((score + bonus) / max) * 10000) / 100) : 0;
  const m = buildScoreMemory(rows, survey);
  assert.equal(m.totals.base_pct, base);
  assert.equal(m.final_pct, final);
});
