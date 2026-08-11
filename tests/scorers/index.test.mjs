import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCORERS } from '../../scripts/lib/scorers/index.mjs';
import { SUBSYSTEMS } from '../../scripts/lib/rubric.mjs';

test('registry order matches the canonical subsystem order', () => {
  assert.deepEqual(SCORERS.map((s) => s.id), SUBSYSTEMS);
});

test('every scorer exports a score function', () => {
  for (const s of SCORERS) assert.equal(typeof s.score, 'function');
});
