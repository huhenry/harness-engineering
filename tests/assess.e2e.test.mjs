import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, cpSync, utimesSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runAssess } from '../scripts/assess.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-08-10T12:00:00Z');
const SCRIPT = join(ROOT, 'scripts', 'assess.mjs');

// Copies a fixture into a fresh temp dir and registers cleanup on the test's
// TestContext, so no run of this file leaks temp directories regardless of
// whether the test body throws.
function copyFixture(t, name) {
  const dst = mkdtempSync(join(tmpdir(), `harness-${name}-`));
  t.after(() => rmSync(dst, { recursive: true, force: true }));
  cpSync(join(ROOT, 'fixtures', name), dst, { recursive: true });
  const p = join(dst, 'PROGRESS.md');
  try { utimesSync(p, NOW, NOW); } catch { /* absent in bad/mid */ }
  return dst;
}

function run(args, cwd, script = SCRIPT) {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { cwd, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function writeVerifyReport(repo, overrides = {}) {
  mkdirSync(join(repo, '.harness'), { recursive: true });
  writeFileSync(join(repo, '.harness', 'verify-report.json'), JSON.stringify({
    schemaVersion: 1, repo, generatedAt: NOW.toISOString(), mode: 'run', passed: true,
    commands: [
      { role: 'bootstrap', status: 'passed' },
      { role: 'test', status: 'passed' },
      { role: 'lint', status: 'passed' },
    ],
    ...overrides,
  }));
}

// --- schema-shape and evidence-freshness behaviour -------------------------

test('runAssess returns a schema-valid report for good-repo', (t) => {
  const repo = copyFixture(t, 'good-repo');
  const r = runAssess({ repoPath: repo, lang: 'en', now: NOW });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.level.id, 3);
  assert.equal(r.evidence.verified, false);
  // No .harness/verify-report.json exists at all — the reason must say so,
  // not leave the user guessing why there's "no evidence".
  assert.equal(r.evidence.reason, 'missing');
});

test('a fresh verify report lifts the evidence cap', (t) => {
  const repo = copyFixture(t, 'good-repo');
  writeVerifyReport(repo);
  const r = runAssess({ repoPath: repo, lang: 'en', now: NOW });
  assert.equal(r.evidence.verified, true);
  assert.equal(r.evidence.reason, null);
  assert.equal(r.level.id, 4);
});

test('a stale verify report is ignored, with reason "stale"', (t) => {
  const repo = copyFixture(t, 'good-repo');
  writeVerifyReport(repo, { generatedAt: '2026-01-01T00:00:00.000Z' });
  const r = runAssess({ repoPath: repo, lang: 'en', now: NOW });
  assert.equal(r.evidence.verified, false);
  assert.equal(r.evidence.reason, 'stale');
});

test('a schema-mismatched verify report is ignored, with reason "schemaMismatch"', (t) => {
  const repo = copyFixture(t, 'good-repo');
  writeVerifyReport(repo, { schemaVersion: 2 });
  const r = runAssess({ repoPath: repo, lang: 'en', now: NOW });
  assert.equal(r.evidence.verified, false);
  assert.equal(r.evidence.reason, 'schemaMismatch');
});

test('a future-dated verify report is rejected, not treated as fresh', (t) => {
  const repo = copyFixture(t, 'good-repo');
  const future = new Date(NOW.getTime() + 24 * 60 * 60 * 1000); // one day ahead of `now`
  writeVerifyReport(repo, { generatedAt: future.toISOString(), passed: true });
  const r = runAssess({ repoPath: repo, lang: 'en', now: NOW });
  // `now - at` is negative here; the naive skeleton's staleness check
  // (`now - at > MAX_AGE_MS`) is false for any negative value, so a forged
  // or clock-skewed future timestamp would slip through as "fresh" unless
  // explicitly rejected. It must not reach L4 on a timestamp that lies about
  // when it ran.
  assert.equal(r.evidence.verified, false);
  assert.equal(r.evidence.reason, 'invalidTimestamp');
  assert.equal(r.level.id, 3, 'must not reach L4 on an untrustworthy timestamp');
});

test('a fresh, schema-valid report that ran but did not pass is not evidence, but still reaches the scorers', (t) => {
  const repo = copyFixture(t, 'good-repo');
  writeVerifyReport(repo, {
    passed: false,
    commands: [
      { role: 'bootstrap', status: 'passed' },
      { role: 'test', status: 'failed' },
      { role: 'lint', status: 'passed' },
    ],
  });
  const r = runAssess({ repoPath: repo, lang: 'en', now: NOW });
  // Categorically different from missing/stale/schema-mismatch: the report
  // was read successfully, so hasEvidence is false but the reason is
  // "failed", not "missing" — and the observed failure must actually
  // surface as a gap, proving the report was handed to the scorers rather
  // than silently dropped (dropping it here would flip "absent evidence !=
  // negative evidence" into "we observed a failure and pretended not to").
  assert.equal(r.evidence.verified, false);
  assert.equal(r.evidence.reason, 'failed');
  const feedback = r.subsystems.find((s) => s.id === 'feedback');
  assert.ok(
    feedback.gaps.some((g) => g.id === 'feedback.commands-failing'),
    'a real observed test failure must produce feedback.commands-failing',
  );
});

test('renderMarkdown surfaces the evidence reason in translated text, en and zh', (t) => {
  const repo = copyFixture(t, 'good-repo');
  const enOut = run([repo, '--lang', 'en'], ROOT).out;
  assert.match(enOut, /run `verify --run`/);
  const zhOut = run([repo, '--lang', 'zh'], ROOT).out;
  assert.match(zhOut, /verify --run/);
  assert.match(zhOut, /未找到验证证据/);
});

// --- CLI surface -------------------------------------------------------

test('--json emits parseable JSON on stdout', (t) => {
  const repo = copyFixture(t, 'mid-repo');
  const { out } = run([repo, '--json'], ROOT);
  const parsed = JSON.parse(out);
  assert.equal(parsed.level.id, 2);
});

test('--min-level gates the exit code', (t) => {
  const repo = copyFixture(t, 'mid-repo');
  assert.equal(run([repo, '--min-level', '2', '--json'], ROOT).code, 0);
  assert.equal(run([repo, '--min-level', '4', '--json'], ROOT).code, 1);
});

test('a malformed --min-level exits 2, distinguishable from an unmet level (exit 1)', (t) => {
  const repo = copyFixture(t, 'mid-repo');
  const bogus = run([repo, '--min-level', 'abc', '--json'], ROOT);
  assert.equal(bogus.code, 2, 'non-numeric --min-level must be a usage error, not a silent NaN comparison');
  const outOfRange = run([repo, '--min-level', '9', '--json'], ROOT);
  assert.equal(outOfRange.code, 2, '--min-level outside 0-5 must also be a usage error');
  const unmet = run([repo, '--min-level', '4', '--json'], ROOT);
  assert.equal(unmet.code, 1, 'a well-formed but unmet --min-level stays a gate failure, not a usage error');
});

test('bad-repo exits 1 because of high-severity gaps', (t) => {
  assert.equal(run([copyFixture(t, 'bad-repo'), '--json'], ROOT).code, 1);
});

test('unknown flag exits 2', (t) => {
  assert.equal(run([copyFixture(t, 'mid-repo'), '--bogus'], ROOT).code, 2);
});

test('an unexpected internal error exits neither 1 nor 2', (t) => {
  // scan.mjs is defensive about a missing repo directory (walk()/existsSync
  // just see no files), so that alone scores as a real, if trivial, L0
  // report and exits 1 through the normal gate path — not a crash. A
  // genuine unexpected exception is `--out` pointing at a directory that
  // does not exist: writeFileSync has nothing to catch that but the
  // top-level handler, well after CliError's own validation has already
  // passed (the flag and its value are both well-formed).
  const repo = copyFixture(t, 'mid-repo');
  const badOut = join(tmpdir(), `harness-out-${process.pid}`, 'does-not-exist', 'report.json');
  const { code } = run([repo, '--json', '--out', badOut], ROOT);
  assert.notEqual(code, 1, 'a write failure is not "the repo scored below the bar"');
  assert.notEqual(code, 2, 'a write failure is not "you mistyped a flag"');
});

// --- config.ignore must actually reach stack detection (two ScanContexts) --

// Regression pin for the two-ScanContext design documented at
// runAssess's `scanCtx` line: createScanContext never reads config on its
// own, so `ignore` only takes effect when passed explicitly. Merging the
// two contexts (`const scanCtx = ctx`) would silently disable `ignore` for
// the whole run — this repo's own fixtures/*/go.mod already demonstrates
// the failure mode (see task-15-report.md for the mutation proof: this
// exact test goes red against that one-line merge, and the rest of the
// 261-test suite does not catch it on its own).
test('harness.config.json\'s ignore excludes a nested manifest from stack detection', (t) => {
  const dst = mkdtempSync(join(tmpdir(), 'harness-ignore-'));
  t.after(() => rmSync(dst, { recursive: true, force: true }));
  // 'node' is always detected via the root package.json regardless of
  // ignore, so it acts as a control signal: if ignore silently stopped
  // working, 'node' would still be there but 'go' would wrongly appear too.
  //
  // The nested manifest deliberately does NOT live under any of
  // scan.mjs's own DEFAULT_IGNORE names (node_modules/.git/dist/build/
  // vendor) — an earlier version of this test used 'vendor/', which is
  // itself one of those built-in defaults, so the manifest was excluded
  // regardless of whether config.ignore ever reached stack detection at
  // all, and the test could never have gone red. 'thirdparty/' carries no
  // built-in meaning, so only the explicit config.ignore below can hide it.
  writeFileSync(join(dst, 'package.json'), JSON.stringify({ name: 'demo' }));
  mkdirSync(join(dst, 'thirdparty'), { recursive: true });
  writeFileSync(join(dst, 'thirdparty', 'go.mod'), 'module vendored\n');
  writeFileSync(join(dst, 'harness.config.json'), JSON.stringify({ ignore: ['thirdparty/**'] }));

  const r = runAssess({ repoPath: dst, lang: 'en', now: NOW });
  assert.deepEqual(
    r.stack,
    ['node'],
    'thirdparty/go.mod must be excluded by the declared ignore — if this includes "go", ' +
    'stack detection ran on a ScanContext that never received config.ignore',
  );
});

// --- read-only contract --------------------------------------------------

function hashTree(dir) {
  const hash = createHash('sha256');
  const walk = (sub, acc) => {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel, acc);
      else acc.push(rel);
    }
    return acc;
  };
  for (const rel of walk('', [])) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(join(dir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// Strengthened per controller ruling: a filename-only `find -type f` diff
// (the plan's original assertion) cannot detect a file being rewritten
// in place with identical byte length, or its content silently mutated —
// only a content-level digest can. See task-15-report.md for the proof that
// this specific assertion fails against a deliberately-writing build.
test('assess never writes to the target repository, at the content level', (t) => {
  const repo = copyFixture(t, 'mid-repo');
  const before = hashTree(repo);
  run([repo, '--json'], ROOT);
  run([repo], ROOT); // markdown mode too — both output paths must stay read-only
  const after = hashTree(repo);
  assert.equal(before, after);
});

// --- robustness: the `import.meta.url` file-identity check must not be
// fooled by paths containing spaces (controller brief C.1) ---------------

test('assess runs correctly when its own script path contains a space', (t) => {
  const spaceDir = mkdtempSync(join(tmpdir(), 'harness assess '));
  t.after(() => rmSync(spaceDir, { recursive: true, force: true }));
  cpSync(join(ROOT, 'scripts'), join(spaceDir, 'scripts'), { recursive: true });
  const repo = copyFixture(t, 'mid-repo');
  const scriptWithSpace = join(spaceDir, 'scripts', 'assess.mjs');
  // mid-repo has real high-severity gaps (e.g. no PROGRESS.md), so a correct
  // run legitimately exits 1 — using the tolerant `run()` helper here
  // (rather than a bare execFileSync that throws on any non-zero exit)
  // keeps this test about "did main() produce real output", not "did it
  // exit 0", which are two different questions.
  const { out } = run([repo, '--json'], ROOT, scriptWithSpace);
  const parsed = JSON.parse(out);
  assert.equal(parsed.level.id, 2, 'main() must actually run and produce a real report, not silently no-op');
});
