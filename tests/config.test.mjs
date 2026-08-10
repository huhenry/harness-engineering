import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, VERIFY_ROLES } from '../scripts/lib/config.mjs';

function fakeCtx(files) {
  return {
    root: '/fake',
    exists: (rel) => Object.hasOwn(files, rel),
    read: (rel) => files[rel] ?? null,
    readJson(rel) { try { return JSON.parse(files[rel]); } catch { return null; } },
    list: () => [],
    mtime: () => null,
    gitLastCommit: () => null,
  };
}

test('roles are fixed and ordered', () => {
  assert.deepEqual(VERIFY_ROLES, ['bootstrap', 'test', 'lint', 'typecheck', 'e2e', 'smoke']);
});

test('harness.config.json wins and fills missing roles with null', () => {
  const cfg = loadConfig(fakeCtx({
    'harness.config.json': JSON.stringify({ lang: 'zh', verify: { test: 'go test ./...' }, ignore: ['vendor/**'] }),
  }));
  assert.equal(cfg.source, 'harness.config.json');
  assert.equal(cfg.lang, 'zh');
  assert.equal(cfg.verify.test, 'go test ./...');
  assert.equal(cfg.verify.lint, null);
  assert.deepEqual(cfg.ignore, ['vendor/**']);
});

test('falls back to AGENTS.md verification section', () => {
  const cfg = loadConfig(fakeCtx({
    'AGENTS.md': ['# P', '', '## Verification', '', '```bash', './init.sh', 'go test ./...', 'golangci-lint run', '```', ''].join('\n'),
  }));
  assert.equal(cfg.source, 'agents-md');
  assert.equal(cfg.verify.bootstrap, './init.sh');
  assert.equal(cfg.verify.test, 'go test ./...');
  assert.equal(cfg.verify.lint, 'golangci-lint run');
  assert.equal(cfg.verify.e2e, null);
});

test('classifies lint before test so "make test-lint" is not mis-bucketed', () => {
  const cfg = loadConfig(fakeCtx({
    'AGENTS.md': ['## Checks', '', '```bash', 'npx eslint .', 'npx vitest run', '```'].join('\n'),
  }));
  assert.equal(cfg.verify.lint, 'npx eslint .');
  assert.equal(cfg.verify.test, 'npx vitest run');
});

test('no config and no AGENTS.md yields all-null with source none', () => {
  const cfg = loadConfig(fakeCtx({}));
  assert.equal(cfg.source, 'none');
  assert.equal(cfg.lang, 'en');
  for (const role of VERIFY_ROLES) assert.equal(cfg.verify[role], null);
  assert.deepEqual(cfg.ignore, []);
});

test('malformed harness.config.json falls through to AGENTS.md', () => {
  const cfg = loadConfig(fakeCtx({
    'harness.config.json': '{broken',
    'AGENTS.md': ['## Verify', '', '```bash', 'pytest -x', '```'].join('\n'),
  }));
  assert.equal(cfg.source, 'agents-md');
  assert.equal(cfg.verify.test, 'pytest -x');
});

// --- self-review: harness.config.json shapes a real repo might actually have ---

test('harness.config.json with verify entirely missing still returns all six null keys', () => {
  const cfg = loadConfig(fakeCtx({ 'harness.config.json': JSON.stringify({ lang: 'en' }) }));
  assert.equal(cfg.source, 'harness.config.json');
  for (const role of VERIFY_ROLES) assert.equal(cfg.verify[role], null);
});

test('harness.config.json with verify set to a non-object (string) does not leak stray keys', () => {
  const cfg = loadConfig(fakeCtx({
    'harness.config.json': JSON.stringify({ verify: 'go test ./...' }),
  }));
  assert.equal(cfg.source, 'harness.config.json');
  assert.deepEqual(Object.keys(cfg.verify).sort(), [...VERIFY_ROLES].sort());
  for (const role of VERIFY_ROLES) assert.equal(cfg.verify[role], null);
});

test('harness.config.json with verify set to an array does not leak numeric-index keys', () => {
  const cfg = loadConfig(fakeCtx({
    'harness.config.json': JSON.stringify({ verify: ['go test ./...'] }),
  }));
  assert.deepEqual(Object.keys(cfg.verify).sort(), [...VERIFY_ROLES].sort());
  for (const role of VERIFY_ROLES) assert.equal(cfg.verify[role], null);
});

test('harness.config.json ignore set to a string (not an array) falls back to []', () => {
  const cfg = loadConfig(fakeCtx({
    'harness.config.json': JSON.stringify({ ignore: 'vendor/**' }),
  }));
  assert.deepEqual(cfg.ignore, []);
});

test('an unknown extra role key in harness.config.json verify is dropped, not passed through', () => {
  const cfg = loadConfig(fakeCtx({
    'harness.config.json': JSON.stringify({ verify: { test: 'go test ./...', bench: 'make bench' } }),
  }));
  assert.equal(cfg.verify.test, 'go test ./...');
  assert.equal(cfg.verify.bench, undefined);
  assert.deepEqual(Object.keys(cfg.verify).sort(), [...VERIFY_ROLES].sort());
});

test('harness.config.json that is a top-level array is not treated as a valid config', () => {
  const cfg = loadConfig(fakeCtx({ 'harness.config.json': JSON.stringify([]) }));
  assert.equal(cfg.source, 'none');
});

test('harness.config.json that is a top-level string is not treated as a valid config', () => {
  const cfg = loadConfig(fakeCtx({ 'harness.config.json': JSON.stringify('x') }));
  assert.equal(cfg.source, 'none');
});

test('harness.config.json that is top-level null is not treated as a valid config', () => {
  const cfg = loadConfig(fakeCtx({ 'harness.config.json': JSON.stringify(null) }));
  assert.equal(cfg.source, 'none');
});

// --- self-review: AGENTS.md / CLAUDE.md shapes a real repo might actually have ---

test('a multi-line command with a trailing backslash continuation is joined before classification', () => {
  const cfg = loadConfig(fakeCtx({
    'AGENTS.md': [
      '## Verification', '',
      '```bash',
      'eslint . \\',
      '  --ext .js,.ts',
      '```',
    ].join('\n'),
  }));
  assert.equal(cfg.source, 'agents-md');
  assert.equal(cfg.verify.lint, 'eslint . --ext .js,.ts');
  assert.ok(!cfg.verify.lint.includes('\\'), 'joined command must not retain the line-continuation backslash');
});

test('two candidate sections in AGENTS.md resolve deterministically to the first in document order', () => {
  const md = [
    '## Testing', '',
    '```bash', 'pytest -x', '```', '',
    '## Verification', '',
    '```bash', 'golangci-lint run', '```',
  ].join('\n');
  const cfg1 = loadConfig(fakeCtx({ 'AGENTS.md': md }));
  const cfg2 = loadConfig(fakeCtx({ 'AGENTS.md': md }));
  assert.equal(cfg1.verify.test, 'pytest -x');
  assert.equal(cfg1.verify.lint, null);
  assert.deepEqual(cfg1, cfg2, 'resolution must be deterministic across repeated runs on the same input');
});

test('CLAUDE.md is used when AGENTS.md is absent', () => {
  const cfg = loadConfig(fakeCtx({
    'CLAUDE.md': ['## Verification', '', '```bash', 'pytest -x', '```'].join('\n'),
  }));
  assert.equal(cfg.source, 'agents-md');
  assert.equal(cfg.verify.test, 'pytest -x');
});

test('a verification section with only prose and no fenced block falls through to source none', () => {
  const cfg = loadConfig(fakeCtx({
    'AGENTS.md': ['## Verification', '', 'Run the tests before committing.', ''].join('\n'),
  }));
  assert.equal(cfg.source, 'none');
  for (const role of VERIFY_ROLES) assert.equal(cfg.verify[role], null);
});

test('a verification section with only prose in AGENTS.md falls through to a real one in CLAUDE.md', () => {
  const cfg = loadConfig(fakeCtx({
    'AGENTS.md': ['## Verification', '', 'Run the tests before committing.', ''].join('\n'),
    'CLAUDE.md': ['## Verification', '', '```bash', 'pytest -x', '```'].join('\n'),
  }));
  assert.equal(cfg.source, 'agents-md');
  assert.equal(cfg.verify.test, 'pytest -x');
});
