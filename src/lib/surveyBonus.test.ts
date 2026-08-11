import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surveyDeadline, isWithinDeadline, bonusPoints, SURVEY_DEADLINE_DAYS } from './surveyBonus.js';

const base = new Date('2026-08-10T12:00:00Z');

test('surveyDeadline soma 7 dias', () => {
  assert.equal(SURVEY_DEADLINE_DAYS, 7);
  assert.equal(surveyDeadline(base).toISOString(), '2026-08-17T12:00:00.000Z');
});

test('isWithinDeadline: dentro, na borda e fora', () => {
  assert.equal(isWithinDeadline(base, new Date('2026-08-14T00:00:00Z')), true);   // 4 dias
  assert.equal(isWithinDeadline(base, new Date('2026-08-17T11:59:59Z')), true);   // 6d23h
  assert.equal(isWithinDeadline(base, new Date('2026-08-17T12:00:01Z')), false);  // logo após 7d
  assert.equal(isWithinDeadline(base, new Date('2026-08-20T12:00:00Z')), false);  // 10 dias
});

test('bonusPoints: 10 no prazo, 0 fora', () => {
  assert.equal(bonusPoints(true), 10);
  assert.equal(bonusPoints(false), 0);
});
