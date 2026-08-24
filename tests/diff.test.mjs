import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiff } from '../scripts/lib/diff.mjs';

/** A minimal report shaped like assess --json's real output. */
function report({ total = 12, level = 2, subsystems = {}, gaps = {} } = {}) {
  const ids = ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop'];
  return {
    schemaVersion: 1,
    score: { total, max: 24 },
    level: { id: level, name: `L${level}`, unmetGates: [] },
    subsystems: ids.map((id) => ({
      id,
      score: subsystems[id] ?? 2,
      max: 4,
      cappedByEvidence: false,
      evidence: [],
      gaps: (gaps[id] ?? []).map((g) => ({
        id: g.id, severity: g.severity ?? 'medium', title: 'T', why: 'W', fix: 'F',
        scaffoldable: false, roi: 1, suppressedBy: g.suppressedBy ?? null,
      })),
    })),
  };
}

test('an identical pair is not a regression and has zero deltas', () => {
  const d = computeDiff(report(), report());
  assert.equal(d.regression, false);
  assert.deepEqual(d.regressionReasons, []);
  assert.equal(d.delta.total, 0);
  assert.equal(d.delta.level, 0);
  assert.deepEqual(d.gaps.fixed, []);
  assert.deepEqual(d.gaps.introduced, []);
});

test('a total-score drop is a regression', () => {
  const d = computeDiff(report({ total: 16 }), report({ total: 12 }));
  assert.equal(d.regression, true);
  assert.ok(d.regressionReasons.includes('total'));
  assert.equal(d.delta.total, -4);
});

test('a level drop is a regression', () => {
  const d = computeDiff(report({ level: 4 }), report({ level: 3 }));
  assert.equal(d.regression, true);
  assert.ok(d.regressionReasons.includes('level'));
});

// The reason clause 3 exists: total can hold steady while a gated subsystem
// falls, and levels are gated rather than derived from the total.
test('a subsystem drop at an unchanged total is still a regression', () => {
  const before = report({ total: 12, subsystems: { tools: 1, state: 3 } });
  const after = report({ total: 12, subsystems: { tools: 2, state: 2 } });
  const d = computeDiff(before, after);
  assert.equal(d.regression, true);
  assert.ok(d.regressionReasons.includes('subsystem:state'));
  assert.equal(d.delta.total, 0);
});

test('an improvement is not a regression', () => {
  const d = computeDiff(report({ total: 12, level: 2 }), report({ total: 18, level: 3 }));
  assert.equal(d.regression, false);
  assert.equal(d.delta.total, 6);
  assert.equal(d.delta.level, 1);
});

test('gaps present before and absent after are reported as fixed', () => {
  const before = report({ gaps: { state: [{ id: 'state.no-progress', severity: 'high' }] } });
  const after = report();
  const d = computeDiff(before, after);
  assert.deepEqual(d.gaps.fixed.map((g) => g.id), ['state.no-progress']);
  assert.deepEqual(d.gaps.introduced, []);
});

test('gaps absent before and present after are reported as introduced', () => {
  const before = report();
  const after = report({ gaps: { state: [{ id: 'state.no-progress', severity: 'high' }] } });
  const d = computeDiff(before, after);
  assert.deepEqual(d.gaps.introduced.map((g) => g.id), ['state.no-progress']);
  assert.deepEqual(d.gaps.fixed, []);
});

// THE TRAP. v1.1 added gap suppression: a suppressed gap is still in the
// JSON, carrying suppressedBy, and only the markdown hides it. Diffing the
// VISIBLE list would report a newly-suppressed gap as "fixed" — telling the
// user they repaired something they did not touch. That is the report lying,
// which is the one thing this project exists to prevent.
test('a gap that merely became suppressed is NOT reported as fixed', () => {
  const before = report({ gaps: { loop: [{ id: 'loop.no-budget-cap', severity: 'high' }] } });
  const after = report({
    gaps: { loop: [{ id: 'loop.no-budget-cap', severity: 'high', suppressedBy: 'loop.none' }] },
  });
  const d = computeDiff(before, after);
  assert.deepEqual(d.gaps.fixed, [], 'suppression is not a fix');
  assert.deepEqual(d.gaps.introduced, []);
});

test('a gap that stopped being suppressed is NOT reported as introduced', () => {
  const before = report({
    gaps: { loop: [{ id: 'loop.no-budget-cap', severity: 'high', suppressedBy: 'loop.none' }] },
  });
  const after = report({ gaps: { loop: [{ id: 'loop.no-budget-cap', severity: 'high' }] } });
  const d = computeDiff(before, after);
  assert.deepEqual(d.gaps.introduced, []);
  assert.deepEqual(d.gaps.fixed, []);
});

// gap.title/why/fix and level.name are already-translated strings (see
// report.mjs's determinism contract), so an en report and a zh report of the
// same repository legitimately differ in every one of them. Comparing by id
// is what makes a cross-language diff mean anything.
test('reports built in different languages diff by id, not by title', () => {
  const en = report({ gaps: { state: [{ id: 'state.no-progress', severity: 'high' }] } });
  const zh = report({ gaps: { state: [{ id: 'state.no-progress', severity: 'high' }] } });
  zh.level.name = '可复现';
  zh.subsystems.find((s) => s.id === 'state').gaps[0].title = '缺少进度文件';
  const d = computeDiff(en, zh);
  assert.deepEqual(d.gaps.fixed, []);
  assert.deepEqual(d.gaps.introduced, []);
  assert.equal(d.regression, false);
});

// A fixture whose input subsystems already happen to be in rubric order
// cannot distinguish "the output order comes from SUBSYSTEMS" from "the
// output order comes from whichever report was passed in" — mapping over
// `before.subsystems` instead of `SUBSYSTEMS` would pass just as easily.
// Reversing the input is what makes the two hypotheses diverge.
test('subsystems come out in the rubric order, always, even when the input is not', () => {
  const before = report();
  before.subsystems = [...before.subsystems].reverse();
  const d = computeDiff(before, report());
  assert.deepEqual(
    d.subsystems.map((s) => s.id),
    ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop'],
  );
});

// A new gap id shipped by a tool upgrade raises every repository's gap count
// without any repository changing. Counting that as a regression would make
// upgrading the tool look like breaking the repo.
test('a newly introduced gap id alone is not a regression', () => {
  const before = report({ total: 12, level: 2 });
  const after = report({ total: 12, level: 2, gaps: { loop: [{ id: 'loop.no-entrypoint', severity: 'low' }] } });
  const d = computeDiff(before, after);
  assert.equal(d.regression, false);
  assert.deepEqual(d.gaps.introduced.map((g) => g.id), ['loop.no-entrypoint']);
});

// A missing or NaN score.total/score.max/level.id, or a report missing one
// of the six SUBSYSTEMS ids, must not flow into arithmetic: NaN < 0 is
// false, so an unguarded deltaTotal/deltaLevel would make the corresponding
// regression clause silently never fire, and a missing subsystem used to
// fall back to a fabricated score of 0 — a large phantom drop. computeDiff
// is expected to throw a TypeError naming the offending field and side
// (before/after) instead of computing on data it cannot trust.
const MALFORMED_CASES = [
  { desc: 'score.total is missing', hint: 'score.total', mutate: (r) => { delete r.score.total; } },
  { desc: 'score.total is NaN', hint: 'score.total', mutate: (r) => { r.score.total = NaN; } },
  { desc: 'score.max is missing', hint: 'score.max', mutate: (r) => { delete r.score.max; } },
  { desc: 'score.max is NaN', hint: 'score.max', mutate: (r) => { r.score.max = NaN; } },
  { desc: 'level.id is missing', hint: 'level.id', mutate: (r) => { delete r.level.id; } },
  { desc: 'level.id is NaN', hint: 'level.id', mutate: (r) => { r.level.id = NaN; } },
  {
    desc: 'a subsystem is missing entirely',
    hint: 'state',
    mutate: (r) => { r.subsystems = r.subsystems.filter((s) => s.id !== 'state'); },
  },
  {
    desc: "a subsystem's score is NaN",
    hint: 'state',
    mutate: (r) => { r.subsystems.find((s) => s.id === 'state').score = NaN; },
  },
];

for (const { desc, hint, mutate } of MALFORMED_CASES) {
  test(`computeDiff throws when the BEFORE report has ${desc}`, () => {
    const before = report();
    mutate(before);
    assert.throws(
      () => computeDiff(before, report()),
      (err) => err instanceof TypeError && err.message.includes('before') && err.message.includes(hint),
    );
  });

  test(`computeDiff throws when the AFTER report has ${desc}`, () => {
    const after = report();
    mutate(after);
    assert.throws(
      () => computeDiff(report(), after),
      (err) => err instanceof TypeError && err.message.includes('after') && err.message.includes(hint),
    );
  });
}

test('a well-formed pair still computes without throwing', () => {
  assert.doesNotThrow(() => computeDiff(report(), report()));
});
