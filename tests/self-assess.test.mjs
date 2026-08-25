import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

test('CI covers the supported Node range through 24 on current official actions', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /node-version:\s*\[['"]20['"],\s*['"]22['"],\s*['"]24['"]\]/);
  assert.match(ci, /actions\/checkout@v7/);
  assert.match(ci, /actions\/setup-node@v7/);
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

// The placeholder-detection fix (placeholder.mjs) makes an unfilled template
// stop counting as a real artefact. This repository ships templates/ AND has
// its own real, filled-in session-handoff.md and clean-state-checklist.md at
// the root — verified before the fix landed: neither root file contains a
// FILL: marker, and neither is byte-identical to its template. This test is
// the guard that a future edit to either file (or to placeholder.mjs's
// rules) does not silently knock this repository's own State score down.
test('this repository still scores State 4 under the placeholder rule', () => {
  const r = runAssess({ repoPath: ROOT, lang: 'en', now: new Date() });
  const state = r.subsystems.find((s) => s.id === 'state');
  assert.equal(state.score, 4, `State dropped to ${state.score}: ${state.gaps.map((g) => g.id).join(', ')}`);
});

// Fix round 1 of 5 (task-2 review) found the lint command --
// `node --check scripts/*.mjs` -- hand-copied into three files
// (harness.config.json's verify.lint, Makefile's lint target, AGENTS.md's
// Verification code block) and none of them updated when scripts/diff.mjs
// shipped, so `make lint` silently never syntax-checked the new CLI entry
// point. That fix derived the SCRIPT LIST from disk but still hardcoded the
// SET OF PLACES to check to those same three files -- and fix round 2 found
// two more real copies it missed entirely (clean-state-checklist.md,
// evaluator-rubric.md), stale in exactly the same way, because the guard
// was never told to look there. Same defect, one layer up.
//
// This version derives BOTH from ground truth instead of enumerating
// either: the script list from `scripts/*.mjs` on disk, and the set of
// places to check by scanning every file `git ls-files` reports as tracked
// -- the same source of truth this repository actually ships from, so a
// file that isn't tracked can't be a stale published copy of anything. A
// future copy of this command in a new doc, template, or CI workflow gets
// caught automatically; no one has to remember to add it to a list here.
//
// Two things that look like copies but are not get excluded:
//
//   1. `.claude/settings.json`'s `"Bash(node --check *)"` permission
//      pattern -- a wildcard ALLOW rule, not a command this project claims
//      to run. Excluded EXPLICITLY by path below, not left to fall out of
//      the regex by accident (it also happens not to match, since `*` is
//      not a real scripts/<name>.mjs path, but that's not what makes the
//      exclusion correct -- it's a permission grammar this test has no
//      business parsing at all, so it is skipped before any regex sees it).
//   2. This file's own comment above and its two `node --check` regex
//      literals below -- neither is followed by a real `scripts/<name>.mjs`
//      path (the comment says the glob `scripts/*.mjs`; the regex source
//      says `.+$`), so the extraction regex below does not match them. No
//      special-case needed for this file.
//
// `evaluator-rubric.md`'s copy is a markdown inline code span soft-wrapped
// across two source lines (`scripts/assess.mjs scripts/diff.mjs\n
// scripts/scaffold.mjs ...`). CommonMark renders a soft line break as a
// single space, so this reads identically to a reader (or a renderer) as
// the single-line version in the other four files; matching after
// collapsing whitespace follows that same rule instead of demanding every
// doc keep this one command artificially unwrapped forever.
test('every "node --check scripts/…" copy in this repository names every scripts/*.mjs entry point', () => {
  const scriptFiles = readdirSync(join(ROOT, 'scripts'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => e.name)
    .sort();
  assert.ok(scriptFiles.length > 0, 'expected at least one scripts/*.mjs entry point on disk');
  const expected = `node --check ${scriptFiles.map((n) => `scripts/${n}`).join(' ')}`;

  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    // Explicit exclusion, not incidental: a permission pattern, not a copy
    // of the command (see the comment above this test).
    .filter((rel) => rel !== '.claude/settings.json');

  // A real `scripts/<name>.mjs` path -- word characters, dots, hyphens
  // only -- immediately (modulo whitespace) after `node --check`, one or
  // more times. This is what rules out both a bare wildcard and a glob
  // without needing to special-case either: `*` and `scripts/*.mjs` simply
  // do not match `[\w.-]+\.mjs`.
  const COMMAND_RE = /node --check((?: scripts\/[\w.-]+\.mjs)+)/g;

  const occurrences = [];
  for (const rel of tracked) {
    let raw;
    try {
      raw = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      continue; // not a regular readable text file -- can't hold a copy
    }
    const normalized = raw.replace(/\s+/g, ' ');
    for (const m of normalized.matchAll(COMMAND_RE)) {
      occurrences.push({ file: rel, command: `node --check${m[1]}` });
    }
  }

  // A guard that could vacuously pass by never matching anything is the
  // same defect this milestone has already caught twice -- so the scan
  // finding zero occurrences is itself a failure, not a silent skip.
  assert.ok(occurrences.length > 0, 'expected to find at least one real "node --check scripts/…" copy in this repository');

  for (const { file, command } of occurrences) {
    assert.equal(command, expected, `${file} has a stale or divergent copy of the lint command`);
  }
});
