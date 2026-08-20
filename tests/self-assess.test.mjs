import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runAssess } from '../scripts/assess.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('this repository ignores its own fixtures when self-assessing', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'harness.config.json'), 'utf8'));
  assert.ok(cfg.ignore.includes('fixtures/**'), 'fixtures must not pollute the self-assessment');
});

test('this repository reaches at least L3 regardless of verify evidence', () => {
  // Deliberately true whether or not a fresh .harness/verify-report.json
  // happens to exist at test time: L3's only gate is `state >= 3`, and
  // state.mjs never reads verifyReport at all (see scripts/lib/scorers/
  // state.mjs) -- every one of its checks (progress freshness/sections,
  // feature_list.json validity, handoff+checklist presence, AGENTS.md
  // lifecycle documentation) is a fact about files already committed to
  // this repository, not about a command having been run.
  const r = runAssess({ repoPath: ROOT, lang: 'en', now: new Date() });
  assert.ok(r.level.id >= 3, `self level is ${r.level.id}: ${r.level.unmetGates.join(', ')}`);
});

// Brief section G invites reporting further plan defects found beyond B1-B4.
// task-24-brief-raw.md's own Step-1 skeleton asserted
// `r.level.unmetGates` deepEquals `['verify evidence']` alone whenever
// level < 4 -- but that is structurally unreachable given how
// scripts/lib/scorers/feedback.mjs actually works, and is not a bug in
// feedback.mjs to be fixed (it is this project's own core differentiator --
// see README.md's "Why" section): rung 3 requires `hasTestEvidence`, which
// is only true when a fresh, valid `.harness/verify-report.json` recorded
// the `test` role as having actually been executed. So Feedback is
// structurally capped below 3 at exactly the same moment `verify evidence`
// (level.mjs's own second L4 condition) is unmet -- the same missing/stale
// report fails both conditions simultaneously, every time, for any
// repository whose declared commands are honestly all passing (the only
// way to decouple them would be to deliberately declare a command that
// fails or gets blocked purely to game this assertion, which is exactly
// the kind of self-inflicted, evidence-dishonest setup this project exists
// to prevent). Fixed here to assert the pair that is actually, provably
// true: every other subsystem this repository needs for L1-L3
// (instructions, tools, environment, state) is scored from static,
// evidence-independent content and already clears its own threshold
// regardless of whether `verify --run` has been executed recently, so
// those never appear in `unmetGates` -- only the feedback/evidence pair
// ever can, and only together.
test('without fresh verify evidence, the only things blocking L4 are feedback and the evidence gate itself', () => {
  const r = runAssess({ repoPath: ROOT, lang: 'en', now: new Date() });
  if (r.level.id < 4) {
    assert.deepEqual(
      r.level.unmetGates,
      ['feedback >= 3', 'verify evidence'],
      `unexpected blockers: ${r.level.unmetGates.join(', ')}`,
    );
  }
});

// Brief section B1 (Critical): the badge lives at the repository-root
// `harness-badge.json`, not `.harness/badge.json` -- Task 23 moved it there
// because `verify --run` writes a `.harness/.gitignore` containing `*` on
// every run, so nothing under `.harness/` can ever reach git and a badge
// parked there would 404 forever. README.md's badge URL already points at
// the root path; this test follows it rather than the raw plan's stale one.
test('harness-badge.json is a valid shields endpoint payload', () => {
  const b = JSON.parse(readFileSync(join(ROOT, 'harness-badge.json'), 'utf8'));
  assert.equal(b.schemaVersion, 1);
  assert.equal(b.label, 'harness level');
  assert.match(b.message, /^L[0-5]/);
  assert.ok(typeof b.color === 'string');
});

test('the CI workflow gates on min-level 4 and skips its own commits', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /--min-level 4/);
  assert.match(ci, /\[skip ci\]/);
  assert.match(ci, /node-version:\s*\[?\s*'?20/);
  assert.match(ci, /22/);
});

// Not part of the raw plan's own Step-1 skeleton; added because task-24-
// brief.md's own acceptance bar (requirement 2 in the controller's dispatch
// message) is "no `FILL:` string may remain anywhere" once this task is
// done. Task 19's templates deliberately render an unfilled `<!-- FILL: -->`
// as harmless-looking markdown rather than a syntax error, precisely so a
// scaffolded-but-never-finished file doesn't crash anything downstream --
// which also means nothing else in this codebase would ever catch a
// forgotten placeholder. This test is that catch: it enumerates exactly the
// harness files this repository owns (never templates/ or fixtures/, which
// legitimately contain the literal token as the master copy other
// repositories scaffold from) and fails loudly if any of them still carries
// an unfilled placeholder.
test('no scaffolded harness file in this repository still has an unfilled FILL: placeholder', () => {
  const OWN_HARNESS_FILES = [
    'AGENTS.md', 'CLAUDE.md', 'PROGRESS.md', 'feature_list.json', 'feature_list.schema.json',
    'init.sh', 'session-handoff.md', 'clean-state-checklist.md', 'evaluator-rubric.md',
    'Makefile', '.claude/settings.json', '.devcontainer/devcontainer.json',
    'loop/goal-loop.md', 'loop/timer-loop.md', 'loop/maker-checker-loop.md',
    'harness.config.json', 'harness-badge.json',
  ];
  for (const rel of OWN_HARNESS_FILES) {
    const abs = join(ROOT, ...rel.split('/'));
    assert.ok(existsSync(abs), `${rel} is expected to exist in this repository`);
    const text = readFileSync(abs, 'utf8');
    assert.ok(!text.includes('FILL:'), `${rel} still has an unfilled FILL: placeholder`);
  }
});

// ROADMAP#4's fix (placeholder.mjs) makes an unfilled template stop counting
// as a real artefact. This repository ships templates/ AND has its own real,
// filled-in session-handoff.md and clean-state-checklist.md at the root —
// verified before the fix landed: neither root file contains a FILL: marker,
// and neither is byte-identical to its template. This test is the guard that
// a future edit to either file (or to placeholder.mjs's rules) does not
// silently knock this repository's own State score down.
test('this repository still scores State 4 under the placeholder rule', () => {
  const r = runAssess({ repoPath: ROOT, lang: 'en', now: new Date() });
  const state = r.subsystems.find((s) => s.id === 'state');
  assert.equal(state.score, 4, `State dropped to ${state.score}: ${state.gaps.map((g) => g.id).join(', ')}`);
});
