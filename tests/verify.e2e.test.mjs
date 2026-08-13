import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerify } from '../scripts/verify.mjs';
import { t } from '../scripts/lib/i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'verify.mjs');
const NOW = new Date('2026-08-10T12:00:00Z');

// Every temp repo this file creates registers its own cleanup on the
// TestContext, so a full run of this file (which really spawns child
// processes and really creates temp directories, per the task's own
// closing instruction) leaves nothing behind regardless of whether the
// test body throws.
function repoWith(t, verify) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ lang: 'en', verify, ignore: [] }));
  return dir;
}

function run(args, cwd) {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

// --- task-18-brief-raw.md Step 1's own 10 tests, adapted only to register
// cleanup via the TestContext (`t.after`) so no run of this file leaks a
// temp directory. Assertions are unchanged. -----------------------------

test('dry-run marks commands planned, executes nothing, writes nothing', async (t) => {
  const repo = repoWith(t, { test: 'touch SENTINEL_DRY' });
  const r = await runVerify({ repoPath: repo, run: false, now: NOW });
  assert.equal(r.mode, 'dry-run');
  assert.equal(r.commands.find((c) => c.role === 'test').status, 'planned');
  assert.equal(existsSync(join(repo, 'SENTINEL_DRY')), false, 'dry-run must not execute');
  assert.equal(existsSync(join(repo, '.harness', 'verify-report.json')), false, 'dry-run must not write');
  assert.equal(r.passed, true);
});

test('--run executes commands and records real exit codes', async (t) => {
  const repo = repoWith(t, { test: 'exit 0', lint: 'exit 7' });
  const r = await runVerify({ repoPath: repo, run: true, now: NOW });
  assert.equal(r.mode, 'run');
  assert.equal(r.commands.find((c) => c.role === 'test').status, 'passed');
  const lint = r.commands.find((c) => c.role === 'lint');
  assert.equal(lint.status, 'failed');
  assert.equal(lint.exitCode, 7);
  assert.equal(r.passed, false);
});

test('blocked commands are never executed, even with --run', async (t) => {
  const repo = repoWith(t, { test: 'touch SENTINEL_BLOCKED && rm -rf nothing' });
  const r = await runVerify({ repoPath: repo, run: true, now: NOW });
  const cmd = r.commands.find((c) => c.role === 'test');
  assert.equal(cmd.status, 'blocked');
  assert.equal(cmd.blockedBy, 'destructive-rm');
  assert.equal(existsSync(join(repo, 'SENTINEL_BLOCKED')), false, 'blocked command must not run at all');
  assert.equal(r.passed, false);
});

test('--allow lets a specific blocked command through', async (t) => {
  const repo = repoWith(t, { smoke: 'echo deploy-check' });
  const blocked = await runVerify({ repoPath: repo, run: true, now: NOW });
  assert.equal(blocked.commands.find((c) => c.role === 'smoke').status, 'blocked');
  const allowed = await runVerify({
    repoPath: repo, run: true, allowPatterns: [/deploy-check/], now: NOW,
  });
  assert.equal(allowed.commands.find((c) => c.role === 'smoke').status, 'passed');
});

test('timeout is recorded and the process is killed', async (t) => {
  const repo = repoWith(t, { test: 'sleep 30' });
  const started = Date.now();
  const r = await runVerify({ repoPath: repo, run: true, timeoutMs: 500, now: NOW });
  assert.equal(r.commands.find((c) => c.role === 'test').status, 'timeout');
  assert.ok(Date.now() - started < 15_000, 'must not wait for the full sleep');
  assert.equal(r.passed, false);
});

test('--run writes a schema-valid report to .harness/', async (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  await runVerify({ repoPath: repo, run: true, now: NOW });
  const raw = JSON.parse(readFileSync(join(repo, '.harness', 'verify-report.json'), 'utf8'));
  assert.equal(raw.schemaVersion, 1);
  assert.equal(raw.mode, 'run');
  assert.equal(raw.generatedAt, NOW.toISOString());
  assert.equal(raw.passed, true);
});

test('a repo with no declared commands reports empty and passes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = await runVerify({ repoPath: dir, run: true, now: NOW });
  assert.deepEqual(r.commands, []);
  assert.equal(r.passed, true);
});

test('exit code is 1 when a command fails', (t) => {
  const repo = repoWith(t, { test: 'exit 1' });
  assert.equal(run([repo, '--run', '--json'], ROOT).code, 1);
});

test('exit code is 0 for a clean dry-run', (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  assert.equal(run([repo, '--json'], ROOT).code, 0);
});

test('an invalid --allow regex exits 2', (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  assert.equal(run([repo, '--allow', '([', '--json'], ROOT).code, 2);
});

// --- task-18-brief.md section B2: --timeout must be validated, or a typo
// silently fabricates timeout evidence for every declared command. -------

test('B2: a non-numeric --timeout exits 2, not a fabricated all-timeout report', (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  const r = run([repo, '--run', '--timeout', 'abc', '--json'], ROOT);
  assert.equal(r.code, 2);
  // The command must never even have been attempted -- confirm this wasn't
  // a gate failure (1) dressed up as a usage error by accident.
  assert.equal(existsSync(join(repo, '.harness', 'verify-report.json')), false);
});

test('B2: --timeout 0 exits 2 (a zero-length timeout could never let anything run)', (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  assert.equal(run([repo, '--run', '--timeout', '0', '--json'], ROOT).code, 2);
});

test('B2: a negative --timeout exits 2', (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  assert.equal(run([repo, '--run', '--timeout', '-5', '--json'], ROOT).code, 2);
});

test('B2: a --timeout large enough to overflow setTimeout exits 2 instead of instantly timing out every command', (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  // 2^31 - 1 ms is the overflow boundary; comfortably over it in seconds.
  const r = run([repo, '--run', '--timeout', '999999999', '--json'], ROOT);
  assert.equal(r.code, 2);
  assert.equal(existsSync(join(repo, '.harness', 'verify-report.json')), false);
});

test('B2: a valid decimal --timeout converts seconds to milliseconds correctly', (t) => {
  const repo = repoWith(t, { test: 'sleep 5' });
  const started = Date.now();
  const r = run([repo, '--run', '--timeout', '0.3', '--json'], ROOT);
  const elapsed = Date.now() - started;
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.commands.find((c) => c.role === 'test').status, 'timeout');
  assert.ok(elapsed < 10_000, `took ${elapsed}ms -- 0.3s should not wait anywhere near the full 5s sleep`);
});

test('B2: a well-formed but unmet flag stays distinguishable from a usage error (exit 1 vs exit 2)', (t) => {
  const repo = repoWith(t, { test: 'exit 1' });
  const wellFormedFailure = run([repo, '--run', '--timeout', '10', '--json'], ROOT);
  assert.equal(wellFormedFailure.code, 1, 'a real command failure under a valid timeout is a gate failure, not a usage error');
});

// --- task-18-brief.md section B3: checkCommand's overriddenBy must survive
// into the report and be reported prominently, not silently dropped. -----

test('B3: overriddenBy is recorded on the entry and in the written JSON when --allow bypasses a rule', async (t) => {
  const repo = repoWith(t, { smoke: 'echo deploy-check' });
  const r = await runVerify({
    repoPath: repo, run: true, allowPatterns: [/deploy-check/], now: NOW,
  });
  const cmd = r.commands.find((c) => c.role === 'smoke');
  assert.equal(cmd.status, 'passed');
  assert.equal(cmd.overriddenBy, 'deploy-words');

  const raw = JSON.parse(readFileSync(join(repo, '.harness', 'verify-report.json'), 'utf8'));
  assert.equal(raw.commands.find((c) => c.role === 'smoke').overriddenBy, 'deploy-words');
});

test('B3: overriddenBy is also recorded in dry-run mode (the command never executes, but the fact is still true)', async (t) => {
  const repo = repoWith(t, { smoke: 'echo deploy-check' });
  const r = await runVerify({
    repoPath: repo, run: false, allowPatterns: [/deploy-check/], now: NOW,
  });
  const cmd = r.commands.find((c) => c.role === 'smoke');
  assert.equal(cmd.status, 'planned');
  assert.equal(cmd.overriddenBy, 'deploy-words');
});

test('B3: overriddenBy is null for a genuinely safe command and for a command that stayed blocked', async (t) => {
  const repo = repoWith(t, { test: 'echo ok', lint: 'rm -rf /tmp/nonexistent-x' });
  const r = await runVerify({ repoPath: repo, run: true, now: NOW });
  assert.equal(r.commands.find((c) => c.role === 'test').overriddenBy, null);
  const blockedCmd = r.commands.find((c) => c.role === 'lint');
  assert.equal(blockedCmd.status, 'blocked');
  assert.equal(blockedCmd.overriddenBy, null, 'a command that stayed blocked was never overridden');
});

test('B3: the human-readable report surfaces an overridden command prominently, in both languages', (t) => {
  const repo = repoWith(t, { smoke: 'echo deploy-check' });
  const enOut = run([repo, '--run', '--allow', 'deploy-check', '--lang', 'en'], ROOT).out;
  assert.match(enOut, /explicitly allowed/);
  assert.match(enOut, /deploy-words/);
  const zhOut = run([repo, '--run', '--allow', 'deploy-check', '--lang', 'zh'], ROOT).out;
  assert.match(zhOut, /亲手放行/);
  assert.match(zhOut, /deploy-words/);
});

// --- task-18-brief.md section C1: .harness/ gets its own .gitignore so a
// report full of a user's real command output doesn't get committed by
// accident, but an existing customized one is never clobbered. -----------

test('C1: --run writes .harness/.gitignore ignoring everything in the directory', async (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  await runVerify({ repoPath: repo, run: true, now: NOW });
  const gi = readFileSync(join(repo, '.harness', '.gitignore'), 'utf8');
  assert.match(gi, /^\*\s*$/m);
});

test('C1: --run does not overwrite an existing, customized .harness/.gitignore', async (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  mkdirSync(join(repo, '.harness'), { recursive: true });
  writeFileSync(join(repo, '.harness', '.gitignore'), '!verify-report.json\n');
  await runVerify({ repoPath: repo, run: true, now: NOW });
  const gi = readFileSync(join(repo, '.harness', '.gitignore'), 'utf8');
  assert.equal(gi, '!verify-report.json\n');
});

// --- task-18-brief.md section C2: zero declared commands must not read as
// "verified" in the human-readable report, even though passed: true is the
// correct (vacuous) JSON answer. ------------------------------------------

test('C2: a repo with zero declared commands gets an explicit "nothing declared" note, not a bare pass', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-empty-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const enOut = run([dir, '--lang', 'en'], ROOT).out;
  assert.match(enOut, /not the same as "verified"/);
  const zhOut = run([dir, '--lang', 'zh'], ROOT).out;
  assert.match(zhOut, /不等于/);
});

// --- task-18-brief.md section C3: .harness already existing as a file
// (not a directory) must fail as an internal error (exit 3), distinct from
// both a usage error (2) and a gate failure (1). ---------------------------

test('C3: .harness existing as a plain file fails with exit 3, not 1 or 2', (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  writeFileSync(join(repo, '.harness'), 'not a directory');
  const r = run([repo, '--run', '--json'], ROOT);
  assert.notEqual(r.code, 1, 'this is not "the repo failed verification"');
  assert.notEqual(r.code, 2, 'this is not "you mistyped a flag"');
  assert.equal(r.code, 3);
});

test('C3: runVerify itself rejects (does not silently succeed) when .harness is a plain file', async (t) => {
  const repo = repoWith(t, { test: 'echo ok' });
  writeFileSync(join(repo, '.harness'), 'not a directory');
  await assert.rejects(() => runVerify({ repoPath: repo, run: true, now: NOW }));
});

// --- i18n sanity: every new key this task added resolves in both langs ---

test('every verify.* i18n key used by this module resolves in both languages', () => {
  const keys = [
    'verify.title', 'verify.mode.dryRun', 'verify.mode.run', 'verify.result.passed',
    'verify.result.failed', 'verify.commands.heading', 'verify.col.role', 'verify.col.command',
    'verify.col.status', 'verify.status.planned', 'verify.status.blocked', 'verify.status.passed',
    'verify.status.failed', 'verify.status.timeout', 'verify.blocked.heading',
    'verify.overridden.heading', 'verify.overridden.warning', 'verify.noCommands.note',
    'verify.runHint', 'verify.reportWritten',
  ];
  for (const key of keys) {
    assert.doesNotThrow(() => t(key, 'en'), `en: ${key}`);
    assert.doesNotThrow(() => t(key, 'zh'), `zh: ${key}`);
  }
});
