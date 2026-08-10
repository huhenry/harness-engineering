import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBSYSTEMS, GAPS, gapById, gapsFor } from '../scripts/lib/rubric.mjs';
import { MESSAGES } from '../scripts/lib/i18n.mjs';

test('subsystem order is fixed', () => {
  assert.deepEqual(SUBSYSTEMS, ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop']);
});

test('gap ids are unique and namespaced by subsystem', () => {
  const ids = GAPS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate gap id');
  for (const g of GAPS) assert.ok(g.id.startsWith(`${g.subsystem}.`), `${g.id} misnamed`);
});

test('every gap declares valid severity, effort and scaffold fields', () => {
  for (const g of GAPS) {
    assert.ok(['high', 'medium', 'low'].includes(g.severity), `${g.id} severity`);
    assert.ok([1, 2, 3].includes(g.effort), `${g.id} effort`);
    assert.equal(typeof g.scaffoldable, 'boolean', `${g.id} scaffoldable`);
    assert.ok(Array.isArray(g.templates), `${g.id} templates`);
    if (g.scaffoldable) assert.ok(g.templates.length > 0, `${g.id} scaffoldable but no templates`);
    else assert.equal(g.templates.length, 0, `${g.id} not scaffoldable but has templates`);
  }
});

test('every gap has bilingual title, why and fix messages', () => {
  for (const g of GAPS) {
    for (const suffix of ['title', 'why', 'fix']) {
      const key = `gap.${g.id}.${suffix}`;
      assert.ok(MESSAGES.en[key], `missing en ${key}`);
      assert.ok(MESSAGES.zh[key], `missing zh ${key}`);
    }
  }
});

test('every subsystem has at least one gap', () => {
  for (const s of SUBSYSTEMS) assert.ok(gapsFor(s).length > 0, `${s} has no gaps`);
});

test('gapById throws on unknown id', () => {
  assert.equal(gapById('loop.none').subsystem, 'loop');
  assert.throws(() => gapById('nope.nope'), /Unknown gap id/);
});
