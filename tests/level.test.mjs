import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLevel } from '../scripts/lib/level.mjs';
import { MESSAGES } from '../scripts/lib/i18n.mjs';

const scores = (o = {}) => ({
  instructions: 0, tools: 0, environment: 0, state: 0, feedback: 0, loop: 0, ...o,
});

test('L0 when instructions below 2', () => {
  assert.equal(computeLevel(scores({ instructions: 1 }), false).id, 0);
});

test('L1 on instructions alone', () => {
  assert.equal(computeLevel(scores({ instructions: 2 }), false).id, 1);
});

test('L2 requires environment and tools', () => {
  assert.equal(computeLevel(scores({ instructions: 4, environment: 2 }), false).id, 1);
  assert.equal(computeLevel(scores({ instructions: 4, environment: 2, tools: 2 }), false).id, 2);
});

test('L3 requires state >= 3', () => {
  const s = scores({ instructions: 4, environment: 2, tools: 2, state: 3 });
  assert.equal(computeLevel(s, false).id, 3);
});

test('L4 requires feedback >= 3 AND verify evidence', () => {
  const s = scores({ instructions: 4, environment: 2, tools: 2, state: 3, feedback: 3 });
  assert.equal(computeLevel(s, false).id, 3, 'no evidence must not reach L4');
  assert.equal(computeLevel(s, true).id, 4);
});

test('L5 requires loop >= 3 and every subsystem >= 3', () => {
  const almost = scores({ instructions: 4, environment: 2, tools: 3, state: 3, feedback: 3, loop: 3 });
  assert.equal(computeLevel(almost, true).id, 4, 'environment=2 blocks L5');
  const all = scores({ instructions: 3, environment: 3, tools: 3, state: 3, feedback: 3, loop: 3 });
  assert.equal(computeLevel(all, true).id, 5);
});

test('unmetGates lists what blocks the next level', () => {
  const s = scores({ instructions: 4, environment: 2, tools: 2, state: 3, feedback: 2 });
  const r = computeLevel(s, false);
  assert.equal(r.id, 3);
  assert.deepEqual(r.unmetGates, ['feedback >= 3', 'verify evidence']);
});

test('unmetGates is empty at the top level', () => {
  const all = scores({ instructions: 4, environment: 4, tools: 4, state: 4, feedback: 4, loop: 4 });
  assert.deepEqual(computeLevel(all, true).unmetGates, []);
});

test('level names exist in both languages', () => {
  for (let i = 0; i <= 5; i += 1) {
    assert.ok(MESSAGES.en[`level.${i}`], `en level.${i}`);
    assert.ok(MESSAGES.zh[`level.${i}`], `zh level.${i}`);
  }
});
