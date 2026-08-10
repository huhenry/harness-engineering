import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../../scripts/lib/scorers/tools.mjs';
import { gapsFor } from '../../scripts/lib/rubric.mjs';

function input(files) {
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
      list: () => [],
      mtime: () => null,
      gitLastCommit: () => null,
    },
    stack: ['go'],
    config: { lang: 'en', verify: {}, ignore: [], source: 'none' },
    verifyReport: null,
    now: new Date('2026-08-10T00:00:00Z'),
  };
}

const SETTINGS_NEITHER = JSON.stringify({ permissions: {} });
const SETTINGS_ALLOW_ONLY = JSON.stringify({ permissions: { allow: ['Bash(go test:*)'] } });
const SETTINGS_BOTH = JSON.stringify({ permissions: { allow: ['Bash(go test:*)'], deny: ['Bash(rm -rf /*)'] } });

test('scores 0 and flags no-entrypoint when no Makefile/justfile/Taskfile/package.json scripts exist', () => {
  const r = score(input({}));
  assert.equal(r.score, 0);
  assert.ok(r.gapIds.includes('tools.no-entrypoint'));
  assert.equal(r.cappedByEvidence, false);
});

test('scores 1 when an entrypoint exists but AGENTS.md never references it', () => {
  const r = score(input({ 'Makefile': 'test:\n\tgo test ./...\n' }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('tools.no-entrypoint'));
});

test('scores 2 when entrypoint is referenced but no permissions file exists', () => {
  const files = {
    'Makefile': 'test:\n\tgo test ./...\n',
    'AGENTS.md': '# Demo\n\nRun `make test` to run the suite.\n',
  };
  const r = score(input(files));
  assert.equal(r.score, 2);
  assert.ok(r.gapIds.includes('tools.no-permissions'));
});

test('scores 3 when entrypoint names match and permissions file exists but lacks a deny list', () => {
  const files = {
    'Makefile': 'test:\n\tgo test ./...\n',
    'AGENTS.md': '# Demo\n\nRun `make test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_ALLOW_ONLY,
  };
  const r = score(input(files));
  assert.equal(r.score, 3);
  assert.ok(r.gapIds.includes('tools.no-least-privilege-doc'));
});

test('scores 4 when entrypoint, references, and least-privilege permissions all line up', () => {
  const files = {
    'Makefile': 'test:\n\tgo test ./...\n',
    'AGENTS.md': '# Demo\n\nRun `make test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
  assert.ok(r.evidence.some((e) => e.path === 'Makefile'));
});

test('flags broken-entrypoint when AGENTS.md references a target the Makefile does not declare', () => {
  const files = {
    'Makefile': 'build:\n\tgo build ./...\n',
    'AGENTS.md': '# Demo\n\nRun `make test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.ok(r.gapIds.includes('tools.broken-entrypoint'));
  assert.ok(r.score <= 2);
});

test('emitted gap ids all belong to this subsystem', () => {
  const r = score(input({}));
  for (const id of r.gapIds) assert.ok(id.startsWith('tools.'), id);
});

// --- additional self-review coverage beyond the brief's minimum ---

test('every gap id this scorer can ever emit exists in the rubric GAPS table', () => {
  const validIds = new Set(gapsFor('tools').map((g) => g.id));
  const scenarios = [
    {},
    { 'Makefile': 'test:\n\tgo test ./...\n' },
    { 'Makefile': 'test:\n\tgo test ./...\n', 'AGENTS.md': '# Demo\n\nRun `make test`.\n' },
    {
      'Makefile': 'test:\n\tgo test ./...\n',
      'AGENTS.md': '# Demo\n\nRun `make test`.\n',
      '.claude/settings.json': SETTINGS_NEITHER,
    },
    {
      'Makefile': 'test:\n\tgo test ./...\n',
      'AGENTS.md': '# Demo\n\nRun `make test`.\n',
      '.claude/settings.json': SETTINGS_ALLOW_ONLY,
    },
    {
      'Makefile': 'test:\n\tgo test ./...\n',
      'AGENTS.md': '# Demo\n\nRun `make test`.\n',
      '.claude/settings.json': SETTINGS_BOTH,
    },
    {
      'Makefile': 'build:\n\tgo build ./...\n',
      'AGENTS.md': '# Demo\n\nRun `make test`.\n',
      '.claude/settings.json': SETTINGS_BOTH,
    },
    { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) },
  ];
  for (const files of scenarios) {
    const r = score(input(files));
    for (const id of r.gapIds) assert.ok(validIds.has(id), `emitted unknown/foreign gap id ${id}`);
  }
});

test('a package.json scripts block is an equally valid entrypoint as a Makefile', () => {
  const files = {
    'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
    'AGENTS.md': '# Demo\n\nRun `npm run test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
});

test('having both a Makefile and package.json scripts still scores 4 when both are honored', () => {
  const files = {
    'Makefile': 'test:\n\tgo test ./...\n',
    'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
    'AGENTS.md': '# Demo\n\nRun `make test` or `npm run test`.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
});

test('a justfile entrypoint is scored the same way as a Makefile', () => {
  const files = {
    'justfile': 'test:\n    go test ./...\n',
    'AGENTS.md': '# Demo\n\nRun `just test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
});

test('a Taskfile.yml entrypoint is scored the same way as a Makefile', () => {
  const files = {
    'Taskfile.yml': "version: '3'\ntasks:\n  test:\n    cmds:\n      - go test ./...\n",
    'AGENTS.md': '# Demo\n\nRun `task test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
});

test('Taskfile.yml target detection survives multiple tasks with nested cmds lists', () => {
  const files = {
    'Taskfile.yml': [
      "version: '3'",
      'tasks:',
      '  build:',
      '    cmds:',
      '      - go build ./...',
      '  test:',
      '    cmds:',
      '      - go test ./...',
      '',
    ].join('\n'),
    'AGENTS.md': '# Demo\n\nRun `task test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.gapIds.includes('tools.broken-entrypoint'), false, 'test task, declared after build, must still be found');
});

test('.cursor/rules satisfies the permissions-file check in place of .claude/settings.json', () => {
  const files = {
    'Makefile': 'test:\n\tgo test ./...\n',
    'AGENTS.md': '# Demo\n\nRun `make test`.\n',
    '.cursor/rules': 'Allowed: git status, go test\nDenied: rm -rf, force push\n',
  };
  const r = score(input(files));
  assert.ok(r.score >= 3);
  assert.equal(r.gapIds.includes('tools.no-permissions'), false);
});

test('a documented allow/deny list in AGENTS.md satisfies least-privilege without a settings file', () => {
  const files = {
    'Makefile': 'test:\n\tgo test ./...\n',
    'AGENTS.md': [
      '# Demo',
      '',
      'Run `make test`.',
      '',
      '## Allowed / Forbidden',
      '',
      'Allow: git status, make test.',
      'Deny: rm -rf, force push.',
      '',
    ].join('\n'),
    '.claude/settings.json': SETTINGS_NEITHER,
  };
  const r = score(input(files));
  assert.equal(r.gapIds.includes('tools.no-least-privilege-doc'), false);
});

test('npm run reference resolves against package.json scripts, not Makefile targets', () => {
  const files = {
    'Makefile': 'build:\n\tgo build ./...\n',
    'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
    'AGENTS.md': '# Demo\n\nRun `npm run test` to run the suite.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.gapIds.includes('tools.broken-entrypoint'), false);
});

test('plain English prose containing "make sure" is not mistaken for a make invocation', () => {
  const files = {
    'Makefile': 'build:\n\tgo build ./...\n',
    'AGENTS.md': '# Demo\n\nMake sure to run `make build` before committing.\n',
    '.claude/settings.json': SETTINGS_BOTH,
  };
  const r = score(input(files));
  assert.equal(r.gapIds.includes('tools.broken-entrypoint'), false);
});
