import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFILE,
  SUPPORTED_PROFILES,
  applyDiagnosticOverlay,
  assertProfile,
  discoverHarnessDistribution,
  profileOverlay,
} from '../scripts/lib/profiles.mjs';
import { analyzeLoopText } from '../scripts/lib/loop-facts.mjs';
import { globToRegExp } from '../scripts/lib/scan.mjs';

test('repository is the default and supported profile ids have one source of truth', () => {
  assert.equal(DEFAULT_PROFILE, 'repository');
  assert.deepEqual(SUPPORTED_PROFILES, ['repository', 'harness-distribution']);
  assert.equal(assertProfile(undefined), DEFAULT_PROFILE);
  for (const profile of SUPPORTED_PROFILES) assert.equal(assertProfile(profile), profile);
});

function context(files) {
  return {
    read: (path) => files[path] ?? null,
    list: (patterns) => Object.keys(files)
      .filter((path) => patterns.some((pattern) => globToRegExp(pattern).test(path)))
      .sort(),
  };
}

const baseResults = () => ({
  instructions: { score: 0, cappedByEvidence: false, evidence: [], gapIds: ['instructions.missing'] },
  tools: { score: 0, cappedByEvidence: false, evidence: [], gapIds: ['tools.no-entrypoint'] },
  environment: { score: 0, cappedByEvidence: false, evidence: [], gapIds: [] },
  state: { score: 0, cappedByEvidence: false, evidence: [], gapIds: [] },
  feedback: { score: 0, cappedByEvidence: true, evidence: [], gapIds: ['feedback.no-tests', 'feedback.no-ci'] },
  loop: {
    score: 0,
    cappedByEvidence: false,
    evidence: [],
    gapIds: [
      'loop.none', 'loop.no-entrypoint', 'loop.no-stop-condition',
      'loop.no-budget-cap', 'loop.no-maker-checker', 'loop.no-rollback',
    ],
  },
});

test('shared loop text facts recognize the existing five semantic checks', () => {
  assert.deepEqual(
    analyzeLoopText(
      'Autonomous loop. Exit criteria: tests pass. Max iterations: 4. '
      + 'A maker-checker reviewer is independent. Rollback with git revert.',
    ),
    {
      hasKeyword: true,
      hasStopCondition: true,
      hasBudgetCap: true,
      hasMakerChecker: true,
      hasRollback: true,
    },
  );
});

test('distribution discovery supports root and nested bundles and excludes GitHub CI', () => {
  const files = {
    'skills/root/SKILL.md': 'root skill',
    'harness/skills/coordinator/SKILL.md': 'nested skill',
    'harness/agents/worker.md': 'worker',
    'harness/workflows/run.js': 'workflow',
    '.github/workflows/ci.yml': 'on: push',
  };
  const found = discoverHarnessDistribution(context(files));
  assert.deepEqual(found.skillFiles, ['harness/skills/coordinator/SKILL.md', 'skills/root/SKILL.md']);
  assert.deepEqual(found.agentFiles, ['harness/agents/worker.md']);
  assert.deepEqual(found.workflowFiles, ['harness/workflows/run.js']);
  assert.doesNotMatch(found.text, /on: push/);
});

test('distribution evidence resolves only facts its files actually contain', () => {
  const files = {
    'harness/skills/coordinator/SKILL.md': [
      'Autonomous loop.',
      'Stop condition: declared checks pass.',
      'Max iterations: 6.',
      'Rollback with git revert after a failed check.',
    ].join('\n'),
    'harness/agents/task-worker.md': 'The worker produces a candidate change.',
    'harness/agents/task-verifier.md': 'The verifier independently checks the candidate.',
    'harness/workflows/chunk-exec.js': 'export function runWorkflow() {}',
  };
  const overlay = profileOverlay({
    profile: 'harness-distribution',
    ctx: context(files),
    config: {},
  });
  assert.deepEqual(
    [...overlay.loop.resolvedGapIds].sort(),
    [
      'loop.none', 'loop.no-entrypoint', 'loop.no-stop-condition',
      'loop.no-budget-cap', 'loop.no-maker-checker', 'loop.no-rollback',
    ].sort(),
  );
  assert.ok(overlay.loop.evidence.every((item) => Object.hasOwn(files, item.path)));
  assert.ok(overlay.loop.evidence.every((item) => !/executed|passed/i.test(item.note)));
});

test('a skill is not an entrypoint, and a lone worker is not maker-checker separation', () => {
  const overlay = profileOverlay({
    profile: 'harness-distribution',
    ctx: context({
      'skills/coordinator/SKILL.md': 'Autonomous loop. Stop condition: green. Budget: 3 attempts.',
      'agents/worker.md': 'The worker writes files.',
    }),
    config: {},
  });
  assert.ok(!overlay.loop.resolvedGapIds.includes('loop.no-entrypoint'));
  assert.ok(!overlay.loop.resolvedGapIds.includes('loop.no-maker-checker'));
});

test('the diagnostic overlay can remove gaps and add evidence but cannot change scores', () => {
  const before = baseResults();
  const after = applyDiagnosticOverlay(before, {
    loop: {
      resolvedGapIds: ['loop.none', 'loop.no-budget-cap'],
      evidence: [{ kind: 'file', path: 'skills/demo/SKILL.md', note: 'distribution profile source' }],
    },
  });
  assert.equal(after.loop.score, before.loop.score);
  assert.equal(after.loop.cappedByEvidence, before.loop.cappedByEvidence);
  assert.ok(!after.loop.gapIds.includes('loop.none'));
  assert.ok(!after.loop.gapIds.includes('loop.no-budget-cap'));
  assert.equal(after.instructions.score, before.instructions.score);
  assert.notStrictEqual(after, before, 'application is immutable');
  assert.ok(before.loop.gapIds.includes('loop.none'), 'the default result was not mutated');
});

test('an overlay that attempts to carry score is rejected structurally', () => {
  assert.throws(
    () => applyDiagnosticOverlay(baseResults(), {
      loop: { resolvedGapIds: [], evidence: [], score: 4 },
    }),
    /score|unsupported/i,
  );
});

test('repository profile produces no overlay and leaves results deep-equal', () => {
  const before = baseResults();
  const overlay = profileOverlay({ profile: 'repository', ctx: context({}), config: {} });
  assert.deepEqual(overlay, {});
  assert.deepEqual(applyDiagnosticOverlay(before, overlay), before);
});

test('an unknown profile is a usage error that names every accepted value', () => {
  assert.throws(
    () => assertProfile('unknown'),
    (err) => err?.exitCode === 2
      && /unknown/.test(err.message)
      && SUPPORTED_PROFILES.every((profile) => err.message.includes(profile)),
  );
});
