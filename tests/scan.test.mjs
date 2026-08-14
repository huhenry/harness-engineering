import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScanContext } from '../scripts/lib/scan.mjs';

// Every temp repository this file creates, removed when the file's tests
// finish. Without this the suite littered the machine it ran on: 1157
// `harness-*` directories had accumulated in $TMPDIR, growing by ~22 on
// every run, because mkdtempSync has no implicit cleanup and these helpers
// never removed what they made. Leaving that in a project whose entire
// subject is engineering discipline is not a good look, and it would follow
// every CI runner too once Task 24 lands.
const TEMP_DIRS = [];
function tempRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}
after(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});


function makeRepo() {
  const root = tempRepo('harness-scan-');
  writeFileSync(join(root, 'AGENTS.md'), '# Hi\nline two\n');
  writeFileSync(join(root, 'package.json'), '{"name":"x"}');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.go'), 'package main');
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'junk', 'b.go'), 'ignored');
  return root;
}

test('exists and read work on relative paths', () => {
  const ctx = createScanContext(makeRepo());
  assert.equal(ctx.exists('AGENTS.md'), true);
  assert.equal(ctx.exists('MISSING.md'), false);
  assert.match(ctx.read('AGENTS.md'), /^# Hi/);
  assert.equal(ctx.read('MISSING.md'), null);
});

test('readJson parses and returns null on bad json', () => {
  const root = makeRepo();
  writeFileSync(join(root, 'bad.json'), '{oops');
  const ctx = createScanContext(root);
  assert.deepEqual(ctx.readJson('package.json'), { name: 'x' });
  assert.equal(ctx.readJson('bad.json'), null);
  assert.equal(ctx.readJson('MISSING.json'), null);
});

test('list matches glob, skips ignored dirs, and is sorted', () => {
  const ctx = createScanContext(makeRepo());
  assert.deepEqual(ctx.list(['**/*.go']), ['src/a.go']);
  const md = ctx.list(['*.md']);
  assert.deepEqual(md, ['AGENTS.md']);
});

test('list result is deterministic across calls', () => {
  const ctx = createScanContext(makeRepo());
  assert.deepEqual(ctx.list(['**/*']), ctx.list(['**/*']));
});

test('gitLastCommit returns null outside a git repo', () => {
  const ctx = createScanContext(makeRepo());
  assert.equal(ctx.gitLastCommit('AGENTS.md'), null);
});

function makeMonorepo() {
  const root = tempRepo('harness-scan-mono-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.go'), 'package main');
  mkdirSync(join(root, 'packages', 'a', 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(root, 'packages', 'a', 'node_modules', 'dep', 'x.go'), 'ignored');
  mkdirSync(join(root, 'services', 'api', 'vendor', 'github.com', 'pkg'), { recursive: true });
  writeFileSync(join(root, 'services', 'api', 'vendor', 'github.com', 'pkg', 'y.go'), 'ignored');
  return root;
}

test('default ignores apply at any depth, not just the repo root', () => {
  const ctx = createScanContext(makeMonorepo());
  assert.deepEqual(ctx.list(['**/*.go']), ['src/a.go']);
});

function makeFixturesRepo() {
  const root = tempRepo('harness-scan-fixtures-');
  mkdirSync(join(root, 'fixtures'), { recursive: true });
  writeFileSync(join(root, 'fixtures', 'root.txt'), 'root fixture');
  mkdirSync(join(root, 'src', 'fixtures'), { recursive: true });
  writeFileSync(join(root, 'src', 'fixtures', 'nested.txt'), 'nested fixture');
  return root;
}

test('caller-supplied ignore patterns match literally, unlike depth-agnostic defaults', () => {
  const ctx = createScanContext(makeFixturesRepo(), { ignore: ['fixtures/**'] });
  const files = ctx.list(['**/*.txt']);
  assert.ok(!files.includes('fixtures/root.txt'), 'root fixtures/ should be ignored');
  assert.ok(files.includes('src/fixtures/nested.txt'), 'nested src/fixtures/ should NOT be ignored');
});

function makePruneRepo() {
  const root = tempRepo('harness-scan-prune-');
  mkdirSync(join(root, 'node_modules', 'deep', 'nested'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'deep', 'nested', 'x.mjs'), 'ignored');
  writeFileSync(join(root, 'keep.mjs'), 'kept');
  return root;
}

test('deeply nested files under an ignored directory are absent from list()', () => {
  const ctx = createScanContext(makePruneRepo());
  assert.deepEqual(ctx.list(['**/*.mjs']), ['keep.mjs']);
});
