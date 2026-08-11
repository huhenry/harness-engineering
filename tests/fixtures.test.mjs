import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { utimesSync } from 'node:fs';
import { createScanContext } from '../scripts/lib/scan.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { computeLevel } from '../scripts/lib/level.mjs';
import { detectStack } from '../scripts/lib/stack.mjs';
import { SCORERS } from '../scripts/lib/scorers/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-08-10T00:00:00Z');

function assess(fixture, verifyReport = null) {
  const root = join(ROOT, 'fixtures', fixture);
  const ctx = createScanContext(root);
  const config = loadConfig(ctx);
  // The stack MUST be detected, not stubbed to []. With an empty stack the
  // environment scorer has no signature to look up and returns 0 for even a
  // perfectly pinned repo (go.mod + go.sum present), and the instructions
  // scorer's version-pinning check can never fire because it has no
  // technology name to look for on the version line. Both mid-repo and
  // good-repo would then fail L2's `environment >= 2` gate and the whole
  // fixture suite would lock in wrong expectations.
  const stack = detectStack(ctx);
  const scores = {};
  for (const s of SCORERS) {
    scores[s.id] = s.score({ ctx, stack, config, verifyReport, now: NOW }).score;
  }
  const hasEvidence = verifyReport !== null;
  return { scores, level: computeLevel(scores, hasEvidence) };
}

// Keep the good-repo progress file "fresh" relative to NOW without committing a timestamp.
function touchProgress() {
  const p = join(ROOT, 'fixtures', 'good-repo', 'PROGRESS.md');
  utimesSync(p, NOW, NOW);
}

test('bad-repo scores L0', () => {
  const { level, scores } = assess('bad-repo');
  assert.equal(level.id, 0);
  assert.equal(scores.instructions, 0);
});

test('mid-repo scores L2 and is blocked by state', () => {
  const { level, scores } = assess('mid-repo');
  assert.equal(level.id, 2);
  assert.ok(scores.state < 3, 'state must be what blocks L3');
  assert.deepEqual(level.unmetGates, ['state >= 3']);
});

test('good-repo without evidence stops at L3', () => {
  touchProgress();
  const { level } = assess('good-repo');
  assert.equal(level.id, 3);
  assert.ok(level.unmetGates.includes('verify evidence'));
});

test('good-repo with passing evidence reaches L4', () => {
  touchProgress();
  const report = { commands: [
    { role: 'bootstrap', status: 'passed' },
    { role: 'test', status: 'passed' },
    { role: 'lint', status: 'passed' },
  ] };
  const { level } = assess('good-repo', report);
  assert.equal(level.id, 4);
});

test('scoring is deterministic across repeated runs', () => {
  touchProgress();
  assert.deepEqual(assess('good-repo').scores, assess('good-repo').scores);
});
