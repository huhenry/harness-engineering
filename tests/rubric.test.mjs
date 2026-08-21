import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SUBSYSTEMS, GAPS, MAX_SCORE, gapById, gapsFor } from '../scripts/lib/rubric.mjs';
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

// Fix round 1, Finding 2: report.mjs's suppression filter (buildReport)
// looks up `presupposedBy` and compares its subsystem membership only via
// `r.gapIds`, which happens to be subsystem-local by construction -- nothing
// stops a future entry from naming a gap in a DIFFERENT subsystem, or a
// typo'd/nonexistent id. Either mistake fails silently and safely: no
// crash, no test signal, no suppression ever taking effect, and a
// maintainer who believes it works. This test walks the whole table once
// and makes that failure mode impossible to land unnoticed.
test('every presupposedBy names a real gap in the SAME subsystem', () => {
  for (const g of GAPS) {
    if (g.presupposedBy === null) continue;
    const pre = GAPS.find((other) => other.id === g.presupposedBy);
    assert.ok(pre, `${g.id}'s presupposedBy ('${g.presupposedBy}') does not name a gap in GAPS`);
    assert.equal(pre.subsystem, g.subsystem,
      `${g.id} (${g.subsystem}) presupposedBy points at ${pre.id} (${pre.subsystem}) -- must be same subsystem`);
  }
});

// An earlier version of this file asserted the opposite invariant -- that a
// suppressed gap must scaffold nothing its precondition does not -- because
// scaffold.mjs really did read the filtered gap list, so suppression could
// silently stop a file being written. That was a bug in scaffold, and it is
// fixed: both behavioural consumers now go through report.mjs's `allGaps`,
// which never filters (pinned by tests/report.test.mjs's source check).
//
// The invariant worth keeping is the one that no longer depends on any
// consumer behaving: a suppressed gap must not be the only claimant of a
// template, because a claimant that is never reported still has to be
// scaffoldable for the file to get written. This is now a statement about
// the table alone, and it deliberately PERMITS loop.no-maker-checker ->
// loop.none, which the old rule forbade: the id is suppressed in the report
// and still scaffolds evaluator-rubric.md, which is exactly right.
test('every template has at least one claimant, suppressed or not', () => {
  const claimed = new Map();
  for (const g of GAPS) {
    for (const tpl of g.templates) {
      if (!claimed.has(tpl)) claimed.set(tpl, []);
      claimed.get(tpl).push(g.id);
    }
  }
  for (const [tpl, claimants] of claimed) {
    assert.ok(claimants.length > 0, `${tpl} has no claimant gap`);
    assert.ok(
      claimants.some((id) => GAPS.find((g) => g.id === id).scaffoldable),
      `${tpl}'s only claimants are non-scaffoldable: ${claimants.join(', ')}`,
    );
  }
});

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lib');

test('MAX_SCORE is the rubric top rung', () => {
  assert.equal(MAX_SCORE, 4);
});

// This project has been bitten four times by hand-synced parallel lists
// drifting apart (see scan.mjs's PRUNE_DIRS/DEFAULT_IGNORE and
// environment.mjs's own header comments). The top rung used to be eight
// independent literal 4s -- one per scorer, plus report.mjs's `max: 4` and
// `SUBSYSTEMS.length * 4`. This test is the guard that they stay collapsed:
// no scorer may write its top rung as a bare number again.
test('no scorer hardcodes its top rung as a literal', () => {
  for (const id of SUBSYSTEMS) {
    const src = readFileSync(join(LIB, 'scorers', `${id}.mjs`), 'utf8');
    assert.ok(
      !/\{\s*score:\s*4\s*,/.test(src),
      `${id}.mjs still writes its top rung as a literal 4 — use MAX_SCORE`,
    );
    assert.match(src, /MAX_SCORE/, `${id}.mjs must import MAX_SCORE`);
  }
});

test('report.mjs does not hardcode the per-subsystem or total max', () => {
  const src = readFileSync(join(LIB, 'report.mjs'), 'utf8');
  assert.ok(!/max:\s*4\b/.test(src), 'report.mjs still writes `max: 4`');
  assert.ok(!/SUBSYSTEMS\.length\s*\*\s*4\b/.test(src), 'report.mjs still writes `SUBSYSTEMS.length * 4`');
  assert.match(src, /MAX_SCORE/);
});
