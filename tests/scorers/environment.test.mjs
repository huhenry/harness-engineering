import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { score } from '../../scripts/lib/scorers/environment.mjs';
import { gapsFor } from '../../scripts/lib/rubric.mjs';
import { createScanContext, globToRegExp } from '../../scripts/lib/scan.mjs';
import { detectStack } from '../../scripts/lib/stack.mjs';

function input({ files = {}, stack = ['node'], verifyReport = null, now = new Date('2026-08-10T00:00:00Z') } = {}) {
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
    stack,
    config: { lang: 'en', verify: {}, ignore: [], source: 'none' },
    verifyReport,
    now,
  };
}

// A node stack with every rung's evidence present: lockfile, runtime pin,
// bootstrap script, and a container file. Only bootstrap *verification* is
// deliberately left to be supplied per-test via verifyReport.
const FULL_ENV = {
  'package.json': '{}',
  'package-lock.json': '{}',
  '.nvmrc': '20\n',
  'init.sh': '#!/bin/sh\necho setup\n',
  'Dockerfile': 'FROM node:20\n',
};

// --- brief's three mandatory key cases ---

test('caps at 3 and marks cappedByEvidence when no verify report exists', () => {
  const r = score(input({ files: FULL_ENV, verifyReport: null }));
  assert.equal(r.score, 3);
  assert.equal(r.cappedByEvidence, true);
  assert.ok(!r.gapIds.includes('environment.bootstrap-fails'), 'must not claim failure without evidence');
});

test('reaches 4 when verify report shows bootstrap passed', () => {
  const report = { commands: [{ role: 'bootstrap', command: './init.sh', status: 'passed' }] };
  const r = score(input({ files: FULL_ENV, verifyReport: report }));
  assert.equal(r.score, 4);
  assert.equal(r.cappedByEvidence, false);
});

test('flags bootstrap-fails only when evidence shows a failure', () => {
  const report = { commands: [{ role: 'bootstrap', command: './init.sh', status: 'failed' }] };
  const r = score(input({ files: FULL_ENV, verifyReport: report }));
  assert.ok(r.gapIds.includes('environment.bootstrap-fails'));
  assert.ok(r.score < 4);
});

// A recorded entry is not the same thing as an executed one. `blocked` means
// this tool's own safety blocklist refused to run the command; `planned`
// means dry-run never ran anything. Neither observed a failure, so neither
// may produce a failure gap — the same "absent evidence != negative
// evidence" contract the test above depends on, applied to the two statuses
// that were previously indistinguishable from a real failure here.
//
// Measured before the fix: blocked, planned, timeout and failed ALL produced
// environment.bootstrap-fails identically, so a repo whose bootstrap command
// we refused to execute was told its bootstrap fails. Found while verifying
// Task 18, which had just fixed the identical bug one file over in
// feedback.mjs; both now derive from verify-status.mjs's isExecutedStatus
// rather than each deciding for itself what counts as evidence.
for (const status of ['blocked', 'planned']) {
  test(`treats a ${status} bootstrap command as no evidence, not as a failure`, () => {
    const report = { commands: [{ role: 'bootstrap', command: './init.sh', status }] };
    const r = score(input({ files: FULL_ENV, verifyReport: report }));
    assert.ok(
      !r.gapIds.includes('environment.bootstrap-fails'),
      `a ${status} command was never executed — claiming it failed asserts an observation nobody made`,
    );
    // Same posture as the no-report case above: capped at 3, and capped
    // *because* evidence is missing — not because some other rung-4
    // condition is genuinely unmet.
    assert.equal(r.score, 3);
    assert.equal(r.cappedByEvidence, true);
  });
}

// --- full rung 0-4 coverage ---

test('scores 0 with no gap when no stack is detected at all', () => {
  const r = score(input({ files: {}, stack: [] }));
  assert.equal(r.score, 0);
  assert.deepEqual(r.gapIds, []);
  assert.equal(r.cappedByEvidence, false);
});

test('scores 0 with no gap when the detected stack has neither lockfile nor runtime pin', () => {
  const r = score(input({ files: { 'package.json': '{}' }, stack: ['node'] }));
  assert.equal(r.score, 0);
  assert.deepEqual(r.gapIds, []);
});

test('scores 1 when a lockfile exists but no runtime pin does', () => {
  const files = { 'package.json': '{}', 'package-lock.json': '{}' };
  const r = score(input({ files }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('environment.no-runtime-pin'));
  assert.equal(r.gapIds.includes('environment.no-lockfile'), false);
});

test('scores 1 when a runtime pin exists but no lockfile does', () => {
  const files = { 'package.json': '{}', '.nvmrc': '20\n' };
  const r = score(input({ files }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('environment.no-lockfile'));
  assert.equal(r.gapIds.includes('environment.no-runtime-pin'), false);
});

test('scores 2 when lockfile and runtime pin both exist but no bootstrap script does', () => {
  const files = { 'package.json': '{}', 'package-lock.json': '{}', '.nvmrc': '20\n' };
  const r = score(input({ files }));
  assert.equal(r.score, 2);
  assert.ok(r.gapIds.includes('environment.no-bootstrap'));
});

test('a config-declared verify.bootstrap command satisfies rung 3 without a script file', () => {
  const files = { 'package.json': '{}', 'package-lock.json': '{}', '.nvmrc': '20\n' };
  const i = input({ files });
  i.config = { lang: 'en', verify: { bootstrap: './custom-setup.sh' }, ignore: [], source: 'harness.config.json' };
  const r = score(i);
  // rung 3 only asks for a bootstrap script/command, which the config
  // provides; rung 4 (container + verified bootstrap) is separately unmet.
  assert.equal(r.score, 3);
  assert.equal(r.cappedByEvidence, false, 'no container file either, so this is a genuine gap, not an evidence gap');
  assert.equal(r.gapIds.includes('environment.no-bootstrap'), false);
  assert.ok(r.gapIds.includes('environment.no-container'));
});

test('scores 3 (not evidence-capped) when everything but the container file is present and bootstrap is verified passing', () => {
  const files = { 'package.json': '{}', 'package-lock.json': '{}', '.nvmrc': '20\n', 'init.sh': '#!/bin/sh\n' };
  const report = { commands: [{ role: 'bootstrap', command: './init.sh', status: 'passed' }] };
  const r = score(input({ files, verifyReport: report }));
  assert.equal(r.score, 3);
  assert.equal(r.cappedByEvidence, false, 'genuine failure (no container), not an evidence gap');
  assert.ok(r.gapIds.includes('environment.no-container'));
  assert.equal(r.gapIds.includes('environment.bootstrap-fails'), false);
});

test('scores 4 with no gaps when every rung is satisfied and verified', () => {
  const report = { commands: [{ role: 'bootstrap', command: './init.sh', status: 'passed' }] };
  const r = score(input({ files: FULL_ENV, verifyReport: report }));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
  assert.equal(r.cappedByEvidence, false);
});

// --- gap id hygiene ---

test('emitted gap ids all belong to this subsystem and exist in the rubric', () => {
  const validIds = new Set(gapsFor('environment').map((g) => g.id));
  const scenarios = [
    { files: {}, stack: [] },
    { files: { 'package.json': '{}' } },
    { files: { 'package.json': '{}', 'package-lock.json': '{}' } },
    { files: { 'package.json': '{}', '.nvmrc': '20\n' } },
    { files: { 'package.json': '{}', 'package-lock.json': '{}', '.nvmrc': '20\n' } },
    { files: FULL_ENV, verifyReport: null },
    { files: FULL_ENV, verifyReport: { commands: [{ role: 'bootstrap', command: './init.sh', status: 'passed' }] } },
    { files: FULL_ENV, verifyReport: { commands: [{ role: 'bootstrap', command: './init.sh', status: 'failed' }] } },
    { files: {}, stack: ['docker'] },
  ];
  for (const opts of scenarios) {
    const r = score(input(opts));
    for (const id of r.gapIds) {
      assert.ok(id.startsWith('environment.'), id);
      assert.ok(validIds.has(id), `unknown gap id ${id}`);
    }
  }
});

// --- self-review: docker's empty lockfiles array must not penalise a container-only repo ---

test('a docker-only repo with a Dockerfile present is not penalised for lacking a lockfile', () => {
  const files = { 'Dockerfile': 'FROM alpine\n', 'init.sh': '#!/bin/sh\n' };
  const r = score(input({ files, stack: ['docker'] }));
  // Dockerfile is simultaneously docker's manifest, its container file, and
  // one of its runtime pins (STACK_SIGNATURES: docker.runtimePins mirrors
  // docker.manifest, so it includes 'Dockerfile' among the compose
  // filenames), and docker's lockfiles: [] is vacuously satisfied, so this
  // repo can climb to rung 3 on file evidence alone (bootstrap verification
  // still ungiven).
  assert.equal(r.gapIds.includes('environment.no-lockfile'), false);
  assert.equal(r.score, 3);
  assert.equal(r.cappedByEvidence, true);
});

test('a docker-only repo with only docker-compose.yml (no Dockerfile) is no longer a silent zero', () => {
  // Review fix: docker.runtimePins in stack.mjs now mirrors docker.manifest
  // (Task 6 already covered all compose filenames in manifest, but left
  // runtimePins as ['Dockerfile'] alone). A compose file is itself the
  // artifact that pins this stack's runtime, so a compose-only repo now
  // reaches rung 2 instead of a diagnosis-free score of 0.
  const files = { 'docker-compose.yml': 'services: {}\n' };
  const r = score(input({ files, stack: ['docker'] }));
  assert.equal(r.score, 2);
  assert.ok(r.gapIds.includes('environment.no-bootstrap'));
});

// --- Review fix regression: docker.runtimePins now mirrors docker.manifest ---
// (verified against a *real* createScanContext + detectStack, not the fake
// test double, so this exercises the actual stack.mjs signature table.)

function makeComposeOnlyRepo(filename) {
  const root = mkdtempSync(join(tmpdir(), 'harness-env-compose-'));
  writeFileSync(join(root, filename), 'services:\n  app:\n    image: alpine\n');
  return root;
}

function scoreRealRepo(root) {
  const ctx = createScanContext(root);
  const stack = detectStack(ctx);
  const r = score({
    ctx,
    stack,
    config: { lang: 'en', verify: {}, ignore: [], source: 'none' },
    verifyReport: null,
    now: new Date('2026-08-10T00:00:00Z'),
  });
  return { stack, r };
}

test('real ScanContext: a docker-compose.yml-only repo scores above 0 and, since it is below 4, always carries an actionable gap', () => {
  const { stack, r } = scoreRealRepo(makeComposeOnlyRepo('docker-compose.yml'));
  assert.deepEqual(stack, ['docker']);
  assert.ok(r.score > 0, 'must not silently score 0 with nothing to point the user at');
  if (r.score < 4) assert.ok(r.gapIds.length > 0, 'below max score, the user must always get something actionable');
});

test('real ScanContext: a compose.yml-only repo (the filename most likely to be missed) also scores above 0 with an actionable gap', () => {
  const { stack, r } = scoreRealRepo(makeComposeOnlyRepo('compose.yml'));
  assert.deepEqual(stack, ['docker']);
  assert.ok(r.score > 0, 'must not silently score 0 with nothing to point the user at');
  if (r.score < 4) assert.ok(r.gapIds.length > 0, 'below max score, the user must always get something actionable');
});

// --- Review fix regression #2: CONTAINER_FILES (the rung-4 containerization
// check) had the same hand-synced-parallel-list hazard as runtimePins did —
// it only recognized 'docker-compose.yml', so a 'compose.yml'-only repo (the
// name Docker Compose itself now prefers) got told it wasn't containerized.
// Looped over every spelling on purpose: this is what makes a future
// addition to stack.mjs's docker manifest without a matching update here
// (or vice versa) fail loudly instead of silently reintroducing the bug.

test('every Compose filename spelling is recognized as containerized, not just docker-compose.yml (parity, looped)', () => {
  const composeSpellings = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  for (const filename of composeSpellings) {
    const root = mkdtempSync(join(tmpdir(), 'harness-env-compose-parity-'));
    writeFileSync(join(root, filename), 'services:\n  app:\n    image: alpine\n');
    // A bootstrap script is included purely to isolate what's under test:
    // without it, rung 3 would also fail and add its own unrelated gap.
    writeFileSync(join(root, 'init.sh'), '#!/bin/sh\n');
    const { stack, r } = scoreRealRepo(root);
    assert.deepEqual(stack, ['docker'], filename);
    assert.equal(
      r.gapIds.includes('environment.no-container'),
      false,
      `${filename}-only repo must not be told it isn't containerized`,
    );
  }
});

// --- self-review: polyglot repo where one stack has a lockfile and another does not ---

test('polyglot repo: node has a lockfile but no pin, python has a pin but no lockfile - aggregate rung 2 still passes', () => {
  const files = {
    'package.json': '{}',
    'package-lock.json': '{}',
    'pyproject.toml': '[project]\n',
    '.python-version': '3.12\n',
  };
  const r = score(input({ files, stack: ['node', 'python'] }));
  assert.ok(r.score >= 2);
  assert.equal(r.gapIds.includes('environment.no-lockfile'), false);
  assert.equal(r.gapIds.includes('environment.no-runtime-pin'), false);
});

// --- not-verified evidence entry ---

test('records a not-verified evidence entry (not a gap) when no verify report is supplied', () => {
  const r = score(input({ files: FULL_ENV, verifyReport: null }));
  assert.ok(r.evidence.some((e) => e.kind === 'command' && e.note === 'not verified' && e.path === 'init.sh'));
});

test('a verify report with no bootstrap entry at all is treated the same as no report (not verified)', () => {
  const report = { commands: [{ role: 'test', command: 'npm test', status: 'passed' }] };
  const r = score(input({ files: FULL_ENV, verifyReport: report }));
  assert.equal(r.score, 3);
  assert.equal(r.cappedByEvidence, true);
  assert.equal(r.gapIds.includes('environment.bootstrap-fails'), false);
});

test('a malformed verify report (no commands array) does not throw and behaves as not verified', () => {
  const r = score(input({ files: FULL_ENV, verifyReport: {} }));
  assert.equal(r.score, 3);
  assert.equal(r.cappedByEvidence, true);
});
