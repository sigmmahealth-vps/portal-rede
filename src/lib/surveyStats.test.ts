import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSurveyStats, SurveyRow } from './surveyStats.js';

const rows: SurveyRow[] = [
  { q1_clareza: 5, q2_portal: 4, q3_documentos: 'sim_totalmente', q4_dificuldade: true,  q5_geral: 5, q6_nps: 10 }, // promotor
  { q1_clareza: 3, q2_portal: 3, q3_documentos: 'sim_parcialmente', q4_dificuldade: false, q5_geral: 4, q6_nps: 8 },  // passivo
  { q1_clareza: 4, q2_portal: 2, q3_documentos: 'sim_totalmente', q4_dificuldade: false, q5_geral: 3, q6_nps: 5 },  // detrator
  { q1_clareza: null, q2_portal: null, q3_documentos: null, q4_dificuldade: null, q5_geral: null, q6_nps: null },   // vazio
];

test('computeSurveyStats calcula NPS, CSAT e distribuições', () => {
  const s = computeSurveyStats(rows);
  assert.equal(s.count, 4);
  assert.equal(s.nps.promoters, 1);
  assert.equal(s.nps.passives, 1);
  assert.equal(s.nps.detractors, 1);
  assert.equal(s.nps.score, 0);
  assert.equal(s.csat.q1, 4);
  assert.equal(s.csat.q2, 3);
  assert.equal(s.csat.q5, 4);
  assert.equal(s.q3['sim_totalmente'], 2);
  assert.equal(s.q3['sim_parcialmente'], 1);
  assert.equal(s.q4DifficultyPct, 33.3);
  assert.deepEqual(s.q4Counts, { sim: 1, nao: 2 });
  // Histogramas: q1 [5,3,4] → nota3=1, nota4=1, nota5=1
  assert.deepEqual(s.dist.q1, [0, 0, 1, 1, 1]);
  // q6 [10,8,5] → score5=1, score8=1, score10=1 (índices 0..10)
  assert.deepEqual(s.dist.q6, [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]);
});

test('computeSurveyStats sem respostas válidas → nps.score null', () => {
  const s = computeSurveyStats([{ q1_clareza: null, q2_portal: null, q3_documentos: null, q4_dificuldade: null, q5_geral: null, q6_nps: null }]);
  assert.equal(s.nps.score, null);
  assert.equal(s.csat.q1, null);
  assert.equal(s.q4DifficultyPct, null);
});
