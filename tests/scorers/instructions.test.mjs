import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../../scripts/lib/scorers/instructions.mjs';
import { gapsFor } from '../../scripts/lib/rubric.mjs';

function input(files) {
  return {
    ctx: {
      root: '/fake',
      exists: (rel) => Object.hasOwn(files, rel),
      read: (rel) => files[rel] ?? null,
      readJson: () => null,
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

const FULL = [
  '# Demo',
  '',
  'Go 1.23 + PostgreSQL 16.',
  '',
  '## Setup',
  '',
  '```bash',
  './init.sh',
  '```',
  '',
  '## Constraints',
  '',
  'Never deploy from a local branch.',
  '',
  '## Verification',
  '',
  '```bash',
  'go test ./...',
  '```',
  '',
  'Details in [architecture](docs/architecture.md).',
  '',
].join('\n');

test('scores 0 and flags missing when no instruction file exists', () => {
  const r = score(input({}));
  assert.equal(r.score, 0);
  assert.ok(r.gapIds.includes('instructions.missing'));
  assert.equal(r.cappedByEvidence, false);
});

test('scores 1 for a bare file with no versions or setup', () => {
  const r = score(input({ 'AGENTS.md': '# Demo\n\nSome prose.\n' }));
  assert.equal(r.score, 1);
  assert.ok(r.gapIds.includes('instructions.no-stack-versions'));
  assert.ok(r.gapIds.includes('instructions.no-setup-commands'));
});

test('scores 2 with versions and setup but no constraints section', () => {
  const doc = '# Demo\n\nGo 1.23.\n\n## Setup\n\n```bash\n./init.sh\n```\n';
  const r = score(input({ 'AGENTS.md': doc }));
  assert.equal(r.score, 2);
  assert.ok(r.gapIds.includes('instructions.no-constraints'));
});

test('scores 3 when complete but flat and under 150 lines', () => {
  const doc = FULL.replace('Details in [architecture](docs/architecture.md).', 'No links here.');
  const r = score(input({ 'AGENTS.md': doc }));
  assert.equal(r.score, 3);
  assert.ok(r.gapIds.includes('instructions.no-layering'));
});

test('scores 4 when layered and all local links resolve', () => {
  const r = score(input({ 'AGENTS.md': FULL, 'docs/architecture.md': '# Arch' }));
  assert.equal(r.score, 4);
  assert.deepEqual(r.gapIds, []);
  assert.ok(r.evidence.some((e) => e.path === 'AGENTS.md'));
});

test('flags stale links when a referenced file is missing', () => {
  const r = score(input({ 'AGENTS.md': FULL }));
  assert.equal(r.score, 3);
  assert.ok(r.gapIds.includes('instructions.stale-links'));
});

test('flags too-long when body exceeds 150 lines', () => {
  const long = FULL + '\nfiller\n'.repeat(160);
  const r = score(input({ 'AGENTS.md': long, 'docs/architecture.md': '# Arch' }));
  assert.ok(r.gapIds.includes('instructions.too-long'));
  assert.ok(r.score <= 2);
});

test('emitted gap ids all belong to this subsystem', () => {
  const r = score(input({}));
  for (const id of r.gapIds) assert.ok(id.startsWith('instructions.'), id);
});

// --- additional self-review coverage beyond the brief's given suite ---

test('every gap id this scorer can ever emit exists in the rubric GAPS table', () => {
  const validIds = new Set(gapsFor('instructions').map((g) => g.id));
  const scenarios = [
    {},
    { 'AGENTS.md': '# Demo\n\nSome prose.\n' },
    { 'AGENTS.md': '# Demo\n\nGo 1.23.\n\n## Setup\n\n```bash\n./init.sh\n```\n' },
    { 'AGENTS.md': FULL.replace('Details in [architecture](docs/architecture.md).', 'No links here.') },
    { 'AGENTS.md': FULL, 'docs/architecture.md': '# Arch' },
    { 'AGENTS.md': FULL },
    { 'AGENTS.md': FULL + '\nfiller\n'.repeat(160), 'docs/architecture.md': '# Arch' },
    { 'CLAUDE.md': FULL, 'docs/architecture.md': '# Arch' },
  ];
  for (const files of scenarios) {
    const r = score(input(files));
    for (const id of r.gapIds) assert.ok(validIds.has(id), `emitted unknown/foreign gap id ${id}`);
  }
});

test('falls back to CLAUDE.md when AGENTS.md is absent', () => {
  const r = score(input({ 'CLAUDE.md': FULL, 'docs/architecture.md': '# Arch' }));
  assert.equal(r.score, 4);
  assert.ok(r.evidence.some((e) => e.path === 'CLAUDE.md'));
});

test('prefers AGENTS.md over CLAUDE.md when both exist, deterministically', () => {
  const files = { 'AGENTS.md': FULL, 'CLAUDE.md': '# Different\n', 'docs/architecture.md': '# Arch' };
  const r1 = score(input(files));
  const r2 = score(input(files));
  assert.ok(r1.evidence.some((e) => e.path === 'AGENTS.md'));
  assert.deepEqual(r1, r2);
});

test('a version number without a stack keyword on the same line does not count as pinned', () => {
  // "2.3" here is a section number, not a stack version, and the line names no
  // detected stack technology (stack: ['go'] in this fixture) — must not satisfy
  // the "有栈版本号...且出现在含技术栈关键词的行" condition.
  const doc = '# Demo\n\nSee section 2.3 for details.\n\n## Setup\n\n```bash\n./init.sh\n```\n';
  const r = score(input(doc ? { 'AGENTS.md': doc } : {}));
  assert.ok(r.gapIds.includes('instructions.no-stack-versions'));
});

test('a link to a root-level .md file does not count as subdirectory layering', () => {
  const doc = FULL.replace(
    'Details in [architecture](docs/architecture.md).',
    'Details in [contributing](CONTRIBUTING.md).',
  );
  const r = score(input({ 'AGENTS.md': doc, 'CONTRIBUTING.md': '# Contributing' }));
  assert.ok(r.gapIds.includes('instructions.no-layering'));
});

test('exactly 150 lines does not trigger too-long', () => {
  const bodyLines = ['# Demo', '', 'Go 1.23.', '', '## Setup', '', '```bash', './init.sh', '```', ''];
  while (bodyLines.length < 150) bodyLines.push('filler');
  const doc = bodyLines.slice(0, 150).join('\n');
  const r = score(input({ 'AGENTS.md': doc }));
  assert.equal(r.gapIds.includes('instructions.too-long'), false);
});

test('151 lines triggers too-long', () => {
  const bodyLines = ['# Demo', '', 'Go 1.23.', '', '## Setup', '', '```bash', './init.sh', '```', ''];
  while (bodyLines.length < 151) bodyLines.push('filler');
  const doc = bodyLines.slice(0, 151).join('\n');
  const r = score(input({ 'AGENTS.md': doc }));
  assert.ok(r.gapIds.includes('instructions.too-long'));
});
