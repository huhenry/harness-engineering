import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../../scripts/lib/scorers/feedback.mjs';
import { gapsFor } from '../../scripts/lib/rubric.mjs';
import { globToRegExp } from '../../scripts/lib/scan.mjs';

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

// Any file matching one of the table's test-file globs is enough for rung 1;
// this repo has exactly one, under tests/.
const HAS_TESTS = { 'tests/example.test.js': 'test("x", () => {});' };

const AGENTS_WITH_OBSERVABILITY = '# Agents\n\nSee /healthz for liveness.\n';

// --- brief's four mandatory key cases (verbatim) ---

test('caps at 2 without a verify report and never claims failure', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'go test ./...' } }, verifyReport: null }));
  assert.equal(r.score, 2);
  assert.equal(r.cappedByEvidence, true);
  assert.ok(r.gapIds.includes('feedback.commands-unverified'));
  assert.ok(!r.gapIds.includes('feedback.commands-failing'));
});

test('reaches 3 only with passing test plus one static check', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' },
  ] };
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x', lint: 'y' } }, verifyReport: report }));
  assert.equal(r.score, 3);
  assert.equal(r.cappedByEvidence, false);
});

test('a failing test command flags commands-failing and blocks level 3', () => {
  const report = { commands: [{ role: 'test', status: 'failed' }] };
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: report }));
  assert.ok(r.gapIds.includes('feedback.commands-failing'));
  assert.ok(r.score < 3);
});

test('test alone without lint or typecheck flags single-check-kind', () => {
  const report = { commands: [{ role: 'test', status: 'passed' }] };
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: report }));
  assert.ok(r.gapIds.includes('feedback.single-check-kind'));
});

// --- full rung 0-4 coverage ---

test('scores 0 and flags no-tests when no test files exist at all', () => {
  const r = score(input({}));
  assert.equal(r.score, 0);
  assert.ok(r.gapIds.includes('feedback.no-tests'));
  assert.equal(r.cappedByEvidence, false);
});

test('scores 1 and flags no-declared-commands when tests exist but nothing is declared in config.verify', () => {
  const r = score(input({ files: HAS_TESTS }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('feedback.no-declared-commands'));
});

test('any declared role (not just test) satisfies rung 2', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { lint: 'eslint .' } } }));
  assert.ok(r.score >= 1);
  assert.equal(r.gapIds.includes('feedback.no-declared-commands'), false);
});

test('scores 4 with no gaps when every rung is fully satisfied and verified', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' },
    { role: 'lint', status: 'passed' },
    { role: 'e2e', status: 'passed' },
  ] };
  const files = { ...HAS_TESTS, '.github/workflows/ci.yml': 'on: push\njobs: {}\n', 'AGENTS.md': AGENTS_WITH_OBSERVABILITY };
  const config = { verify: { test: 'x', lint: 'y', e2e: 'z' } };
  const r = score(input({ files, config, verifyReport: report }));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
  assert.equal(r.cappedByEvidence, false);
});

test('flags no-ci when no CI configuration file exists', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'e2e', status: 'passed' },
  ] };
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x', lint: 'y', e2e: 'z' } }, verifyReport: report }));
  assert.ok(r.gapIds.includes('feedback.no-ci'));
});

test('recognizes .gitlab-ci.yml as a CI configuration', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'e2e', status: 'passed' },
  ] };
  const files = { ...HAS_TESTS, '.gitlab-ci.yml': 'stages: []\n' };
  const r = score(input({ files, config: { verify: { test: 'x', lint: 'y', e2e: 'z' } }, verifyReport: report }));
  assert.equal(r.gapIds.includes('feedback.no-ci'), false);
});

test('recognizes Jenkinsfile as a CI configuration', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'e2e', status: 'passed' },
  ] };
  const files = { ...HAS_TESTS, 'Jenkinsfile': 'pipeline {}\n' };
  const r = score(input({ files, config: { verify: { test: 'x', lint: 'y', e2e: 'z' } }, verifyReport: report }));
  assert.equal(r.gapIds.includes('feedback.no-ci'), false);
});

test('flags no-e2e when a verify report exists but neither e2e nor smoke passed', () => {
  const report = { commands: [{ role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }] };
  const files = { ...HAS_TESTS, '.github/workflows/ci.yml': 'on: push\n' };
  const r = score(input({ files, config: { verify: { test: 'x', lint: 'y' } }, verifyReport: report }));
  assert.ok(r.gapIds.includes('feedback.no-e2e'));
});

test('smoke passing (not just e2e) satisfies the rung-4 e2e-or-smoke condition', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'smoke', status: 'passed' },
  ] };
  const files = { ...HAS_TESTS, '.github/workflows/ci.yml': 'on: push\n' };
  const r = score(input({ files, config: { verify: { test: 'x', lint: 'y', smoke: 's' } }, verifyReport: report }));
  assert.equal(r.gapIds.includes('feedback.no-e2e'), false);
});

test('flags no-observability when nothing declares an observability entrypoint', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'e2e', status: 'passed' },
  ] };
  const files = { ...HAS_TESTS, '.github/workflows/ci.yml': 'on: push\n' };
  const r = score(input({ files, config: { verify: { test: 'x', lint: 'y', e2e: 'z' } }, verifyReport: report }));
  assert.ok(r.gapIds.includes('feedback.no-observability'));
});

test('a declared smoke command satisfies the observability check', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'e2e', status: 'passed' },
  ] };
  const files = { ...HAS_TESTS, '.github/workflows/ci.yml': 'on: push\n' };
  const config = { verify: { test: 'x', lint: 'y', e2e: 'z', smoke: 'curl /healthz' } };
  const r = score(input({ files, config, verifyReport: report }));
  assert.equal(r.gapIds.includes('feedback.no-observability'), false);
});

test('an AGENTS.md mention of /healthz satisfies the observability check', () => {
  const report = { commands: [
    { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'e2e', status: 'passed' },
  ] };
  const files = {
    ...HAS_TESTS,
    '.github/workflows/ci.yml': 'on: push\n',
    'AGENTS.md': AGENTS_WITH_OBSERVABILITY,
  };
  const r = score(input({ files, config: { verify: { test: 'x', lint: 'y', e2e: 'z' } }, verifyReport: report }));
  assert.equal(r.gapIds.includes('feedback.no-observability'), false);
});

// --- section D: no-evidence downgrades for the three rung-4 checks + single-check-kind ---

test('without a verify report, no-e2e still fires when neither e2e nor smoke is even declared', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: null }));
  assert.ok(r.gapIds.includes('feedback.no-e2e'));
});

test('without a verify report, declaring e2e in config suppresses no-e2e (declaration, not a false claim of passing)', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x', e2e: 'npx playwright test' } }, verifyReport: null }));
  assert.equal(r.gapIds.includes('feedback.no-e2e'), false);
});

test('without a verify report, declaring smoke alone also suppresses no-e2e', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x', smoke: 'curl /healthz' } }, verifyReport: null }));
  assert.equal(r.gapIds.includes('feedback.no-e2e'), false);
});

test('without a verify report, single-check-kind still fires when only test is declared', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: null }));
  assert.ok(r.gapIds.includes('feedback.single-check-kind'));
});

test('without a verify report, declaring lint in config suppresses single-check-kind even though it was never run', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x', lint: 'eslint .' } }, verifyReport: null }));
  assert.equal(r.gapIds.includes('feedback.single-check-kind'), false);
});

test('without a verify report, declaring typecheck alone also suppresses single-check-kind', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x', typecheck: 'tsc --noEmit' } }, verifyReport: null }));
  assert.equal(r.gapIds.includes('feedback.single-check-kind'), false);
});

test('no-ci and no-observability are reported without a verify report too — they are file/doc facts, not evidence claims', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: null }));
  assert.ok(r.gapIds.includes('feedback.no-ci'));
  assert.ok(r.gapIds.includes('feedback.no-observability'));
});

// --- cappedByEvidence's narrow contract ---

test('cappedByEvidence is false when there are no tests at all, even with no verify report', () => {
  const r = score(input({ files: {}, config: { verify: {} }, verifyReport: null }));
  assert.equal(r.cappedByEvidence, false);
});

test('cappedByEvidence is false when tests exist but nothing is declared, even with no verify report', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: {} }, verifyReport: null }));
  assert.equal(r.cappedByEvidence, false);
});

test('cappedByEvidence is false once a verify report exists, even if it reports a failure', () => {
  const report = { commands: [{ role: 'test', status: 'failed' }] };
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: report }));
  assert.equal(r.cappedByEvidence, false);
});

test('cappedByEvidence is true for a structurally valid but empty commands array (still no test evidence)', () => {
  // Regression: a report can be non-null and have a real `commands` array
  // yet still say nothing about the test role (e.g. { commands: [] }). The
  // score is capped for exactly the same reason as a fully absent report —
  // no evidence for the test command — so cappedByEvidence must say so too,
  // not read false just because *some* array happened to be present.
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: { commands: [] } }));
  assert.equal(r.score, 2);
  assert.equal(r.cappedByEvidence, true);
  assert.ok(r.gapIds.includes('feedback.commands-unverified'));
  assert.equal(r.gapIds.includes('feedback.commands-failing'), false);
});

// --- malformed verify report must not crash ---

test('a verify report with no commands array at all does not throw and behaves as unverified', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: {} }));
  assert.equal(r.score, 2);
  assert.equal(r.cappedByEvidence, true);
  assert.ok(r.gapIds.includes('feedback.commands-unverified'));
  assert.equal(r.gapIds.includes('feedback.commands-failing'), false);
});

test('a verify report whose commands field is not an array does not throw and behaves as unverified', () => {
  const r = score(input({ files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: { commands: 'oops' } }));
  assert.equal(r.score, 2);
  assert.equal(r.cappedByEvidence, true);
});

// --- gap id hygiene ---

test('emitted gap ids all belong to this subsystem and exist in the rubric', () => {
  const validIds = new Set(gapsFor('feedback').map((g) => g.id));
  const scenarios = [
    {},
    { files: HAS_TESTS },
    { files: HAS_TESTS, config: { verify: { test: 'x' } } },
    { files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: { commands: [{ role: 'test', status: 'passed' }] } },
    { files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: { commands: [{ role: 'test', status: 'failed' }] } },
    {
      files: { ...HAS_TESTS, '.github/workflows/ci.yml': 'on: push\n', 'AGENTS.md': AGENTS_WITH_OBSERVABILITY },
      config: { verify: { test: 'x', lint: 'y', e2e: 'z' } },
      verifyReport: { commands: [
        { role: 'test', status: 'passed' }, { role: 'lint', status: 'passed' }, { role: 'e2e', status: 'passed' },
      ] },
    },
    { files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: {} },
    { files: HAS_TESTS, config: { verify: { test: 'x' } }, verifyReport: { commands: 'oops' } },
  ];
  for (const opts of scenarios) {
    const r = score(input(opts));
    for (const id of r.gapIds) {
      assert.ok(id.startsWith('feedback.'), id);
      assert.ok(validIds.has(id), `unknown gap id ${id}`);
    }
  }
});
