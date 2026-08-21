import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../../scripts/lib/scorers/loop.mjs';
import { gapsFor } from '../../scripts/lib/rubric.mjs';
import { globToRegExp } from '../../scripts/lib/scan.mjs';
import { buildReport, allGaps, visibleGaps } from '../../scripts/lib/report.mjs';

/** Wrap one loop scorer result in a real report, so the assertions below can
 *  be about what a user is actually shown rather than about raw gap ids. */
function report(loopResult) {
  const empty = { score: 0, cappedByEvidence: false, evidence: [], gapIds: [] };
  return buildReport({
    repo: '/fake',
    stack: [],
    results: {
      instructions: empty, tools: empty, environment: empty, state: empty, feedback: empty, loop: loopResult,
    },
    hasEvidence: false,
    evidenceReason: 'missing',
    verifiedAt: null,
    toolVersion: '0.1.0',
    now: new Date('2026-08-10T00:00:00Z'),
    lang: 'en',
  });
}

function input({
  files = {},
  config = { lang: 'en', verify: {}, ignore: [], source: 'none' },
  verifyReport = null,
  now = new Date('2026-08-10T00:00:00Z'),
} = {}) {
  return {
    ctx: {
      root: '/fake',
      exists: (rel) => Object.hasOwn(files, rel),
      read: (rel) => files[rel] ?? null,
      readJson: (rel) => {
        const raw = files[rel];
        if (raw === undefined) return null;
        try { return JSON.parse(raw); } catch { return null; }
      },
      list: (patterns) => Object.keys(files).filter((f) => patterns.some((p) => globToRegExp(p).test(f))),
      mtime: () => null,
      gitLastCommit: () => null,
    },
    stack: ['node'],
    config,
    verifyReport,
    now,
  };
}

const STOP_AND_BUDGET = 'Exit criteria: all tests green. Max iterations: 10 per session.\n';
const MAKER_CHECKER_AND_ROLLBACK = 'Uses a maker-checker loop. On failure, git revert the last commit.\n';

// --- full rung 0-4 coverage ---

test('scores 0 with no gap-worthy loop keyword anywhere and no loop entry', () => {
  const r = score(input({}));
  assert.equal(r.score, 0);
  assert.ok(r.gapIds.includes('loop.none'));
  assert.equal(r.cappedByEvidence, false);
});

// Rungs 1 and 2 no longer share an id (see loop.mjs's own note): a repo
// with nothing at all fails both and reports both, and rubric.mjs suppresses
// loop.no-entrypoint beneath loop.none so the rendered report is unchanged.
test('a repo with nothing at all reports both rung-1 and rung-2 gaps, each once', () => {
  const r = score(input({}));
  assert.equal(r.gapIds.filter((g) => g === 'loop.none').length, 1);
  assert.equal(r.gapIds.filter((g) => g === 'loop.no-entrypoint').length, 1);
});

test('a keyword in CLAUDE.md is recognized', () => {
  const files = { 'CLAUDE.md': '循环执行直到通过。\n' };
  const r = score(input({ files, config: { verify: {}, loop: { kind: 'cron' } } }));
  assert.ok(r.score >= 1);
});

test('a keyword only in README.md is recognized (loop docs commonly live there, unlike instructions.mjs which only reads AGENTS/CLAUDE)', () => {
  const files = { 'README.md': 'Runs on a scheduled cron loop.\n' };
  const r = score(input({ files, config: { verify: {}, loop: {} } }));
  assert.ok(r.score >= 1);
});

test('a keyword only under loop/*.md is recognized', () => {
  const files = { 'loop/goal-loop.md': 'This is our autonomous loop design.\n' };
  const r = score(input({ files, config: { verify: {} } }));
  assert.ok(r.score >= 1, 'loop/ directory files both satisfy the keyword check and the entry-point check');
});

// The distinction the id split exists for. This repo DOES describe a loop,
// so loop.none is false about it and must not fire -- only loop.no-entrypoint
// does. While both rungs shared one id, the rung-3+ properties were keyed to
// loop.none and got suppressed for this repo, which is the one that most
// needs to hear them.
test('scores 1 when the keyword is present but there is no loop entry point at all', () => {
  const files = { 'AGENTS.md': 'This project runs an autonomous loop, described only in prose.\n' };
  const r = score(input({ files }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('loop.no-entrypoint'));
  assert.equal(r.gapIds.includes('loop.none'), false, 'a loop IS described here');
});

test('a scheduled GitHub Actions workflow satisfies the rung-2 entry-point check', () => {
  const files = {
    'AGENTS.md': 'Runs an autonomous loop.\n',
    '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  };
  const r = score(input({ files }));
  assert.ok(r.score >= 2);
});

test('a config.loop field satisfies the rung-2 entry-point check', () => {
  const files = { 'AGENTS.md': 'Runs an autonomous loop.\n' };
  const r = score(input({ files, config: { verify: {}, loop: { maxIterations: 10 } } }));
  assert.ok(r.score >= 2);
});

test('a scheduled GitHub Actions workflow using the .yaml extension also satisfies the rung-2 entry-point check', () => {
  // Same bug class as feedback.mjs's CI-file check: GitHub Actions accepts
  // both .yml and .yaml under .github/workflows/, and both files use the
  // same shared CI_WORKFLOW_GLOBS to avoid drifting apart again.
  const files = {
    'AGENTS.md': 'Runs an autonomous loop.\n',
    '.github/workflows/nightly.yaml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  };
  const r = score(input({ files }));
  assert.ok(r.score >= 2);
});

// --- review finding: LOOP_KEYWORD_RE must be word-boundary anchored ---

test('a bare substring match inside an unrelated word must not count as a loop keyword ("loophole", "micron")', () => {
  const files = {
    'README.md': 'We are developing a new feature and closing a loophole in the micron-precision config.\n',
  };
  const r = score(input({ files }));
  assert.equal(r.score, 0);
  assert.ok(r.gapIds.includes('loop.none'));
  assert.equal(r.evidence.some((e) => e.note === 'loop pattern described'), false);
});

// End-to-end proof of Regression C, on the rendered report rather than on
// scorer gapIds: the described-but-unwired repo must KEEP its two
// high-severity loop gaps, and the never-heard-of-a-loop repo must not be
// told four more things about a loop it does not have.
test('a described-but-unwired loop keeps its high-severity gaps; a loopless repo does not', () => {
  const described = report(score(input({
    files: { 'AGENTS.md': 'Runs an autonomous nightly loop. A reviewer agent checks each batch; failures are reverted (rollback).\n' },
  })));
  const shownIds = visibleGaps(described).map((g) => g.id);
  assert.ok(shownIds.includes('loop.no-stop-condition'), `stop-condition gap must survive, got ${shownIds}`);
  assert.ok(shownIds.includes('loop.no-budget-cap'), `budget-cap gap must survive, got ${shownIds}`);
  assert.ok(shownIds.includes('loop.no-entrypoint'));
  assert.equal(shownIds.includes('loop.none'), false);

  const loopless = report(score(input({})));
  assert.deepEqual(visibleGaps(loopless).map((g) => g.id), ['loop.none'],
    'a repo with no loop at all is told one thing, not five');
  assert.ok(allGaps(loopless).some((g) => g.severity === 'high'),
    'the suppressed high-severity gaps are still there for anything behavioural');
});

test('genuine standalone Latin loop keywords are still recognized after anchoring', () => {
  const files = { 'README.md': 'This project uses an autonomous agent loop, run on a cron schedule.\n' };
  const r = score(input({ files }));
  assert.ok(r.score >= 1);
});

test('genuine CJK loop keywords are still recognized after anchoring (CJK alternatives must not get \\b)', () => {
  const files = { 'README.md': '本项目使用自主循环执行任务。\n' };
  const r = score(input({ files }));
  assert.ok(r.score >= 1);
});

test('scores 2 with no-stop-condition and no-budget-cap when neither is documented', () => {
  const files = {
    'AGENTS.md': 'Runs an autonomous loop.\n',
    '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  };
  const r = score(input({ files }));
  assert.equal(r.score, 2);
  assert.ok(r.gapIds.includes('loop.no-stop-condition'));
  assert.ok(r.gapIds.includes('loop.no-budget-cap'));
});

test('scores 3 when stop condition and budget cap are both documented', () => {
  const files = {
    'AGENTS.md': `Runs an autonomous loop. ${STOP_AND_BUDGET}`,
    '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  };
  const r = score(input({ files }));
  assert.equal(r.score, 3);
  assert.ok(r.gapIds.includes('loop.no-maker-checker'));
  assert.ok(r.gapIds.includes('loop.no-rollback'));
});

test('only a stop condition (no budget cap) keeps the score at 2', () => {
  const files = {
    'AGENTS.md': 'Runs an autonomous loop. Exit criteria: all green.\n',
    '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  };
  const r = score(input({ files }));
  assert.equal(r.score, 2);
  assert.ok(r.gapIds.includes('loop.no-budget-cap'));
  assert.equal(r.gapIds.includes('loop.no-stop-condition'), false);
});

test('scores 4 with no gaps when every rung is satisfied', () => {
  const files = {
    'AGENTS.md': `Runs an autonomous loop. ${STOP_AND_BUDGET}${MAKER_CHECKER_AND_ROLLBACK}`,
    '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  };
  const r = score(input({ files }));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
  assert.equal(r.cappedByEvidence, false);
});

test('an evaluator-rubric.md file satisfies the maker-checker condition without prose', () => {
  const files = {
    'AGENTS.md': `Runs an autonomous loop. ${STOP_AND_BUDGET}Rolls back with git revert on failure.\n`,
    '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
    'evaluator-rubric.md': '# Rubric\n',
  };
  const r = score(input({ files }));
  assert.equal(r.score, 4);
  assert.equal(r.gapIds.includes('loop.no-maker-checker'), false);
});

// --- loop is doc/config-only: cappedByEvidence is always false ---

test('cappedByEvidence is always false regardless of verifyReport', () => {
  const files = {
    'AGENTS.md': `Runs an autonomous loop. ${STOP_AND_BUDGET}${MAKER_CHECKER_AND_ROLLBACK}`,
    '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  };
  const r1 = score(input({ files, verifyReport: null }));
  const r2 = score(input({ files, verifyReport: { commands: [] } }));
  assert.equal(r1.cappedByEvidence, false);
  assert.equal(r2.cappedByEvidence, false);
});

// --- gap id hygiene ---

test('emitted gap ids all belong to this subsystem and exist in the rubric', () => {
  const validIds = new Set(gapsFor('loop').map((g) => g.id));
  const scenarios = [
    {},
    { files: { 'AGENTS.md': 'Runs an autonomous loop.\n' } },
    {
      files: {
        'AGENTS.md': 'Runs an autonomous loop.\n',
        '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
      },
    },
    {
      files: {
        'AGENTS.md': `Runs an autonomous loop. ${STOP_AND_BUDGET}`,
        '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
      },
    },
    {
      files: {
        'AGENTS.md': `Runs an autonomous loop. ${STOP_AND_BUDGET}${MAKER_CHECKER_AND_ROLLBACK}`,
        '.github/workflows/nightly.yml': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
      },
    },
  ];
  for (const opts of scenarios) {
    const r = score(input(opts));
    for (const id of r.gapIds) {
      assert.ok(id.startsWith('loop.'), id);
      assert.ok(validIds.has(id), `unknown gap id ${id}`);
    }
  }
});
