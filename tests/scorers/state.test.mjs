import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, validateFeatureList } from '../../scripts/lib/scorers/state.mjs';
import { gapsFor } from '../../scripts/lib/rubric.mjs';
import { globToRegExp } from '../../scripts/lib/scan.mjs';

const NOW = new Date('2026-08-10T00:00:00Z');
const FRESH = new Date('2026-08-05T00:00:00Z'); // 5 days before NOW
const STALE = new Date('2026-01-01T00:00:00Z'); // well over 30 days before NOW

function input({
  files = {},
  mtimes = {},
  gitLastCommits = {},
  now = NOW,
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
      mtime: (rel) => mtimes[rel] ?? null,
      gitLastCommit: (rel) => gitLastCommits[rel] ?? null,
    },
    stack: ['go'],
    config: { lang: 'en', verify: {}, ignore: [], source: 'none' },
    verifyReport: null,
    now,
  };
}

const DONE_DOING_BLOCKED = [
  '# Progress',
  '',
  '## Done',
  '',
  '- Shipped the thing.',
  '',
  '## In Progress',
  '',
  '- Doing the next thing.',
  '',
  '## Blocked',
  '',
  '- Nothing blocked right now.',
  '',
].join('\n');

const VALID_FEATURE_LIST = JSON.stringify({
  features: [{ id: 'a', title: 'A', status: 'todo' }, { id: 'b', title: 'B', status: 'done' }],
});

const AGENTS_WITH_LIFECYCLE = [
  '# Agents',
  '',
  'At session start, read PROGRESS.md. At session end, update it.',
  '',
].join('\n');

// --- brief's mandatory key cases ---

test('stale progress file scores 1 even when complete', () => {
  const r = score(input({
    files: { 'PROGRESS.md': DONE_DOING_BLOCKED },
    mtimes: { 'PROGRESS.md': new Date('2026-01-01T00:00:00Z') },
    now: new Date('2026-08-10T00:00:00Z'),
  }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('state.progress-stale'));
});

test('feature_list.json with duplicate ids is invalid', () => {
  const files = { 'PROGRESS.md': DONE_DOING_BLOCKED, 'feature_list.json': JSON.stringify({
    features: [{ id: 'a', title: 'A', status: 'todo' }, { id: 'a', title: 'B', status: 'done' }],
  }) };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.ok(r.gapIds.includes('state.feature-list-invalid'));
});

test('feature_list.json with an unknown status is invalid', () => {
  const files = { 'PROGRESS.md': DONE_DOING_BLOCKED, 'feature_list.json': JSON.stringify({
    features: [{ id: 'a', title: 'A', status: 'shipped' }],
  }) };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.ok(r.gapIds.includes('state.feature-list-invalid'));
});

// --- full rung 0-4 coverage ---

test('scores 0 and flags no-progress when no progress file exists at all', () => {
  const r = score(input({}));
  assert.equal(r.score, 0);
  // Every rung is still evaluated (ladder.mjs never short-circuits), so
  // higher-rung failures (staleness of a nonexistent file, no handoff docs,
  // ...) surface too — the one load-bearing assertion is that the rung-1
  // gap for the actual root cause is present.
  assert.ok(r.gapIds.includes('state.no-progress'));
  assert.equal(r.cappedByEvidence, false);
});

test('recognizes claude-progress.md as a valid progress file name', () => {
  const r = score(input({ files: { 'claude-progress.md': DONE_DOING_BLOCKED }, mtimes: { 'claude-progress.md': FRESH } }));
  assert.ok(r.score >= 2);
});

test('recognizes docs/PROGRESS.md as a valid progress file name', () => {
  const r = score(input({ files: { 'docs/PROGRESS.md': DONE_DOING_BLOCKED }, mtimes: { 'docs/PROGRESS.md': FRESH } }));
  assert.ok(r.score >= 2);
});

test('scores 1 when the progress file is fresh but missing a section (incomplete)', () => {
  const doc = ['# Progress', '', '## Done', '', '- Shipped it.', ''].join('\n');
  const r = score(input({ files: { 'PROGRESS.md': doc }, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('state.progress-incomplete'));
  assert.equal(r.gapIds.includes('state.progress-stale'), false);
});

test('scores 2 when fresh and complete but no feature_list.json exists', () => {
  const r = score(input({ files: { 'PROGRESS.md': DONE_DOING_BLOCKED }, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.score, 2);
  assert.ok(r.gapIds.includes('state.no-feature-list'));
});

test('scores 3 when feature_list.json is valid but handoff files are missing', () => {
  const files = { 'PROGRESS.md': DONE_DOING_BLOCKED, 'feature_list.json': VALID_FEATURE_LIST };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.score, 3);
  assert.ok(r.gapIds.includes('state.no-handoff'));
});

test('scores 3 when handoff files exist but AGENTS.md does not document session lifecycle', () => {
  const files = {
    'PROGRESS.md': DONE_DOING_BLOCKED,
    'feature_list.json': VALID_FEATURE_LIST,
    'session-handoff.md': '# Handoff',
    'clean-state-checklist.md': '# Checklist',
  };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.score, 3);
  assert.ok(r.gapIds.includes('state.lifecycle-undocumented'));
});

test('scores 4 with no gaps when every rung is satisfied', () => {
  const files = {
    'PROGRESS.md': DONE_DOING_BLOCKED,
    'feature_list.json': VALID_FEATURE_LIST,
    'session-handoff.md': '# Handoff',
    'clean-state-checklist.md': '# Checklist',
    'AGENTS.md': AGENTS_WITH_LIFECYCLE,
  };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
  assert.equal(r.cappedByEvidence, false);
});

// --- gap id hygiene ---

test('emitted gap ids all belong to this subsystem and exist in the rubric', () => {
  const validIds = new Set(gapsFor('state').map((g) => g.id));
  const scenarios = [
    {},
    { files: { 'PROGRESS.md': DONE_DOING_BLOCKED }, mtimes: { 'PROGRESS.md': STALE } },
    { files: { 'PROGRESS.md': '# Progress\n\n## Done\n' }, mtimes: { 'PROGRESS.md': FRESH } },
    { files: { 'PROGRESS.md': DONE_DOING_BLOCKED }, mtimes: { 'PROGRESS.md': FRESH } },
    {
      files: { 'PROGRESS.md': DONE_DOING_BLOCKED, 'feature_list.json': VALID_FEATURE_LIST },
      mtimes: { 'PROGRESS.md': FRESH },
    },
    {
      files: {
        'PROGRESS.md': DONE_DOING_BLOCKED,
        'feature_list.json': VALID_FEATURE_LIST,
        'session-handoff.md': '# Handoff',
        'clean-state-checklist.md': '# Checklist',
        'AGENTS.md': AGENTS_WITH_LIFECYCLE,
      },
      mtimes: { 'PROGRESS.md': FRESH },
    },
  ];
  for (const opts of scenarios) {
    const r = score(input(opts));
    for (const id of r.gapIds) {
      assert.ok(id.startsWith('state.'), id);
      assert.ok(validIds.has(id), `unknown gap id ${id}`);
    }
  }
});

// --- self-review: freshness boundary ---

test('exactly 30 days old counts as fresh', () => {
  const ts = new Date(NOW.getTime() - 30 * 864e5);
  const r = score(input({ files: { 'PROGRESS.md': DONE_DOING_BLOCKED }, mtimes: { 'PROGRESS.md': ts } }));
  assert.equal(r.gapIds.includes('state.progress-stale'), false);
});

test('31 days old counts as stale', () => {
  const ts = new Date(NOW.getTime() - 31 * 864e5);
  const r = score(input({ files: { 'PROGRESS.md': DONE_DOING_BLOCKED }, mtimes: { 'PROGRESS.md': ts } }));
  assert.ok(r.gapIds.includes('state.progress-stale'));
});

test('gitLastCommit null falls back to mtime for freshness', () => {
  const r = score(input({
    files: { 'PROGRESS.md': DONE_DOING_BLOCKED },
    mtimes: { 'PROGRESS.md': FRESH },
    gitLastCommits: {},
  }));
  assert.equal(r.gapIds.includes('state.progress-stale'), false);
});

test('gitLastCommit, when present, wins over a stale mtime', () => {
  const r = score(input({
    files: { 'PROGRESS.md': DONE_DOING_BLOCKED },
    mtimes: { 'PROGRESS.md': STALE },
    gitLastCommits: { 'PROGRESS.md': FRESH },
  }));
  assert.equal(r.gapIds.includes('state.progress-stale'), false);
});

// --- self-review: feature_list.json shape edge cases ---

test('validateFeatureList: a top-level array is invalid ("valid JSON but not an object")', () => {
  const problems = validateFeatureList([1, 2, 3]);
  assert.ok(problems.length > 0);
});

test('validateFeatureList: a top-level string is invalid', () => {
  const problems = validateFeatureList('hello');
  assert.ok(problems.length > 0);
});

test('validateFeatureList: features present but not an array is invalid', () => {
  const problems = validateFeatureList({ features: { a: 1 } });
  assert.ok(problems.length > 0);
});

test('validateFeatureList: zero features is valid', () => {
  const problems = validateFeatureList({ features: [] });
  assert.deepEqual(problems, []);
});

test('a feature_list.json with zero features is schema-valid and does not block rung 3', () => {
  const files = { 'PROGRESS.md': DONE_DOING_BLOCKED, 'feature_list.json': JSON.stringify({ features: [] }) };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.gapIds.includes('state.feature-list-invalid'), false);
  assert.equal(r.gapIds.includes('state.no-feature-list'), false);
  assert.ok(r.score >= 3);
});

test('a feature_list.json that is malformed JSON is treated as invalid, not missing', () => {
  const files = { 'PROGRESS.md': DONE_DOING_BLOCKED, 'feature_list.json': '{not valid json' };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.ok(r.gapIds.includes('state.feature-list-invalid'));
  assert.equal(r.gapIds.includes('state.no-feature-list'), false);
});

// --- self-review: session-handoff.md nested in a subdirectory ---

test('session-handoff.md and clean-state-checklist.md are detected at any directory depth', () => {
  const files = {
    'PROGRESS.md': DONE_DOING_BLOCKED,
    'feature_list.json': VALID_FEATURE_LIST,
    'docs/handoff/session-handoff.md': '# Handoff',
    'ops/clean-state-checklist.md': '# Checklist',
    'AGENTS.md': AGENTS_WITH_LIFECYCLE,
  };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.score, 4);
  assert.equal(r.gapIds.includes('state.no-handoff'), false);
});

// --- self-review: prose-only lifecycle mention (no matching heading) ---

test('a session lifecycle mention in plain prose (no heading) still satisfies the check', () => {
  const files = {
    'PROGRESS.md': DONE_DOING_BLOCKED,
    'feature_list.json': VALID_FEATURE_LIST,
    'session-handoff.md': '# Handoff',
    'clean-state-checklist.md': '# Checklist',
    'AGENTS.md': '# Agents\n\nJust some prose that happens to say session start and session end in passing.\n',
  };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.equal(r.score, 4);
  assert.equal(r.gapIds.includes('state.lifecycle-undocumented'), false);
});

test('AGENTS.md missing entirely means lifecycle is undocumented', () => {
  const files = {
    'PROGRESS.md': DONE_DOING_BLOCKED,
    'feature_list.json': VALID_FEATURE_LIST,
    'session-handoff.md': '# Handoff',
    'clean-state-checklist.md': '# Checklist',
  };
  const r = score(input({ files, mtimes: { 'PROGRESS.md': FRESH } }));
  assert.ok(r.gapIds.includes('state.lifecycle-undocumented'));
  assert.equal(r.score, 3);
});
