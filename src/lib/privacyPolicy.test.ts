import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsPrivacyAcceptance, PRIVACY_POLICY_VERSION } from './privacyPolicy.ts';

test('sem aceite precisa aceitar', () => {
  assert.equal(needsPrivacyAcceptance(null), true);
  assert.equal(needsPrivacyAcceptance(undefined), true);
});

test('versão antiga precisa aceitar de novo', () => {
  assert.equal(needsPrivacyAcceptance('2000-01-01'), true);
});

test('versão atual não precisa', () => {
  assert.equal(needsPrivacyAcceptance(PRIVACY_POLICY_VERSION), false);
});
