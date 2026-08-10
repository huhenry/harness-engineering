import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRoi, sortGaps, SEVERITY_WEIGHT } from '../scripts/lib/roi.mjs';

const g = (id, severity, effort) => ({ id, severity, effort, subsystem: id.split('.')[0] });

test('severity weights are fixed', () => {
  assert.deepEqual(SEVERITY_WEIGHT, { high: 5, medium: 3, low: 1 });
});

test('roi follows the documented formula and clamps to 1..10', () => {
  // high(5) * (4-0) / 1 = 20 -> clamped to 10
  assert.equal(computeRoi(g('a.x', 'high', 1), 0), 10);
  // medium(3) * (4-2) / 2 = 3
  assert.equal(computeRoi(g('a.x', 'medium', 2), 2), 3);
  // low(1) * (4-3) / 3 = 0.33 -> rounds to 0 -> clamped to 1
  assert.equal(computeRoi(g('a.x', 'low', 3), 3), 1);
});

test('sortGaps orders by roi desc, then severity, then id', () => {
  const gaps = [
    { ...g('b.two', 'low', 1), roi: 4 },
    { ...g('a.one', 'high', 1), roi: 4 },
    { ...g('c.three', 'high', 1), roi: 9 },
  ];
  assert.deepEqual(sortGaps(gaps).map((x) => x.id), ['c.three', 'a.one', 'b.two']);
});

test('sortGaps does not mutate its input', () => {
  const gaps = [{ ...g('b.two', 'low', 1), roi: 1 }, { ...g('a.one', 'high', 1), roi: 9 }];
  const before = gaps.map((x) => x.id);
  sortGaps(gaps);
  assert.deepEqual(gaps.map((x) => x.id), before);
});
