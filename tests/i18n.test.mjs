import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, MESSAGES, SUPPORTED_LANGS, assertLang } from '../scripts/lib/i18n.mjs';

test('returns localized string per language', () => {
  assert.equal(t('subsystem.instructions', 'en'), 'Instructions');
  assert.equal(t('subsystem.instructions', 'zh'), '指令');
});

test('interpolates variables', () => {
  assert.equal(t('report.score', 'en', { total: 18, max: 24 }), 'Score: 18 / 24');
  assert.equal(t('report.score', 'zh', { total: 18, max: 24 }), '得分：18 / 24');
});

test('missing key throws', () => {
  assert.throws(() => t('nope.nope', 'en'), /Missing i18n key: nope\.nope/);
});

test('en and zh tables have identical key sets', () => {
  const en = Object.keys(MESSAGES.en).sort();
  const zh = Object.keys(MESSAGES.zh).sort();
  assert.deepEqual(zh, en, 'zh table must cover exactly the same keys as en');
});

test('assertLang rejects unsupported language', () => {
  assert.deepEqual(SUPPORTED_LANGS, ['en', 'zh']);
  assert.equal(assertLang('zh'), 'zh');
  assert.throws(() => assertLang('fr'), /Unsupported language/);
});
