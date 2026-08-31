import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIFF = join(ROOT, 'scripts', 'diff.mjs');

const TEMP_DIRS = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

/**
 * Write a real `assess --json` report for a fixture into `dir`.
 *
 * `assess.mjs` legitimately exits 1 for a fixture with real high-severity
 * gaps (bad-repo, mid-repo) -- see tests/assess.e2e.test.mjs's own "bad-repo
 * exits 1" test -- even though `--out` has already written the report to
 * disk by the time that exit code is decided. `execFileSync` throws on any
 * non-zero exit by default, so calling it unguarded here would make every
 * test that builds a bad-repo/mid-repo fixture via this helper fail before
 * `diff.mjs` is ever invoked, for a reason that has nothing to do with
 * `diff.mjs`. The try/catch discards that exit code deliberately: this
 * helper's only job is "the file exists on disk", not "assess approved of
 * the repository".
 */
function assessTo(dir, fixture, name) {
  const out = join(dir, name);
  try {
    execFileSync('node', [join(ROOT, 'scripts', 'assess.mjs'), join(ROOT, 'fixtures', fixture), '--json', '--out', out]);
  } catch { /* non-zero exit for a repo with real gaps is expected; the report was still written */ }
  return out;
}

const run = (args) => spawnSync('node', [DIFF, ...args], { encoding: 'utf8' });

test('an improvement exits 0 and names the movement', () => {
  const d = tempDir('harness-diff-up-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const after = assessTo(d, 'good-repo', 'after.json');
  const r = run([before, after]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0\s*->\s*16|0 → 16/);
});

// This is the property that lets a team gate CI on it.
test('a regression exits 1', () => {
  const d = tempDir('harness-diff-down-');
  const before = assessTo(d, 'good-repo', 'before.json');
  const after = assessTo(d, 'bad-repo', 'after.json');
  const r = run([before, after]);
  assert.equal(r.status, 1, r.stderr);
});

test('an identical pair exits 0', () => {
  const d = tempDir('harness-diff-same-');
  const a = assessTo(d, 'mid-repo', 'a.json');
  const b = assessTo(d, 'mid-repo', 'b.json');
  assert.equal(run([a, b]).status, 0);
});

test('--json emits the DiffResult and nothing else', () => {
  const d = tempDir('harness-diff-json-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const after = assessTo(d, 'good-repo', 'after.json');
  const r = run([before, after, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.profile, 'repository');
  assert.equal(parsed.regression, false);
  assert.equal(parsed.delta.total, 16);
});

test('reports from different profiles are a usage error, not a fabricated gap improvement', () => {
  const d = tempDir('harness-diff-profile-');
  const before = assessTo(d, 'mid-repo', 'before.json');
  const after = assessTo(d, 'mid-repo', 'after.json');
  const changed = JSON.parse(readFileSync(after, 'utf8'));
  changed.profile = 'harness-distribution';
  writeFileSync(after, JSON.stringify(changed));
  const r = run([before, after]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /profile/i);
  assert.match(r.stderr, /repository/);
  assert.match(r.stderr, /harness-distribution/);
});

test('a legacy report without profile remains compatible with repository reports', () => {
  const d = tempDir('harness-diff-legacy-profile-');
  const before = assessTo(d, 'mid-repo', 'before.json');
  const after = assessTo(d, 'mid-repo', 'after.json');
  const legacy = JSON.parse(readFileSync(before, 'utf8'));
  delete legacy.profile;
  writeFileSync(before, JSON.stringify(legacy));
  const r = run([before, after, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).profile, 'repository');
});

test('--out writes to a file and prints nothing', () => {
  const d = tempDir('harness-diff-out-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const after = assessTo(d, 'good-repo', 'after.json');
  const out = join(d, 'diff.md');
  const r = run([before, after, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.ok(readFileSync(out, 'utf8').length > 0);
});

test('a missing file is a usage error, not a crash', () => {
  const d = tempDir('harness-diff-missing-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const r = run([before, join(d, 'nope.json')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nope\.json/);
});

test('unparseable JSON is a usage error, not a crash', () => {
  const d = tempDir('harness-diff-bad-json-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const bad = join(d, 'bad.json');
  writeFileSync(bad, '{ not json');
  const r = run([before, bad]);
  assert.equal(r.status, 2);
});

// Comparing two different schema versions produces numbers that look
// plausible and mean nothing. Refuse rather than answer.
test('a schemaVersion mismatch is refused, not silently compared', () => {
  const d = tempDir('harness-diff-schema-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const after = assessTo(d, 'good-repo', 'after.json');
  const bumped = JSON.parse(readFileSync(after, 'utf8'));
  bumped.schemaVersion = 2;
  const path = join(d, 'bumped.json');
  writeFileSync(path, JSON.stringify(bumped));
  const r = run([before, path]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /schema/i);
});

test('too few arguments is a usage error', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['only-one.json']).status, 2);
});

test('both languages render and say the same numbers', () => {
  const d = tempDir('harness-diff-lang-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const after = assessTo(d, 'good-repo', 'after.json');
  const en = run([before, after, '--lang', 'en']);
  const zh = run([before, after, '--lang', 'zh']);
  assert.equal(en.status, 0);
  assert.equal(zh.status, 0);
  assert.notEqual(en.stdout, zh.stdout, 'the two languages must actually differ');
  for (const out of [en.stdout, zh.stdout]) assert.match(out, /16/);
});

// scripts/lib/diff.mjs's computeDiff validates both reports and throws a
// plain TypeError naming the exact field and side that failed (see its own
// validateReport). This CLI must catch that TypeError itself and convert it
// to exit code 2 (a usage error -- "you gave me a bad file"), not let it
// fall through to the generic top-level handler that exits 3 ("the tool
// itself broke"). The TypeError's message text must survive into stderr
// unchanged so the user can see which field, on which side, was the
// problem -- not a vaguer, re-wrapped summary of it.
test('a malformed report (deleted level.id) is a usage error, and stderr names the field', () => {
  const d = tempDir('harness-diff-malformed-');
  const before = assessTo(d, 'bad-repo', 'before.json');
  const after = assessTo(d, 'good-repo', 'after.json');
  const mutated = JSON.parse(readFileSync(after, 'utf8'));
  delete mutated.level.id;
  const path = join(d, 'mutated.json');
  writeFileSync(path, JSON.stringify(mutated));
  const r = run([before, path]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /level\.id/);
});
