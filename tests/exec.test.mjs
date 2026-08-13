import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { runCommand, truncateOutput } from '../scripts/lib/exec.mjs';

// --- Plan's own 8 tests (task-17-brief-raw.md Step 1), verbatim -----------

test('truncateOutput keeps head and tail and marks truncation', () => {
  const text = Array.from({ length: 500 }, (_, i) => `line${i}`).join('\n');
  const r = truncateOutput(text, 3, 2);
  assert.equal(r.truncated, true);
  assert.match(r.text, /^line0\nline1\nline2\n/);
  assert.match(r.text, /line498\nline499$/);
  assert.match(r.text, /lines omitted/);
});

test('truncateOutput passes short text through unchanged', () => {
  const r = truncateOutput('a\nb', 100, 100);
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'a\nb');
});

test('captures stdout and a zero exit code', async () => {
  const r = await runCommand('echo hello', { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.equal(r.exitCode, 0);
  assert.equal(r.timedOut, false);
  assert.match(r.stdout, /hello/);
  assert.ok(r.durationMs >= 0);
});

test('captures a non-zero exit code and stderr', async () => {
  const r = await runCommand('echo oops 1>&2; exit 3', { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.equal(r.exitCode, 3);
  assert.match(r.stderr, /oops/);
});

test('kills a command that exceeds the timeout', async () => {
  const r = await runCommand('sleep 30', { cwd: tmpdir(), timeoutMs: 500 });
  assert.equal(r.timedOut, true);
  assert.equal(r.exitCode, null);
  assert.ok(r.durationMs < 10_000, 'must not wait for the full sleep');
});

test('injects HARNESS_VERIFY into the child environment', async () => {
  const r = await runCommand('echo $HARNESS_VERIFY', { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.match(r.stdout.trim(), /^1$/);
});

test('never rejects, even for a nonexistent binary', async () => {
  const r = await runCommand('definitely-not-a-real-binary-xyz', { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.notEqual(r.exitCode, 0);
  assert.equal(r.timedOut, false);
});

test('truncates very large output', async () => {
  const r = await runCommand('seq 1 5000', { cwd: tmpdir(), timeoutMs: 20_000 });
  assert.equal(r.truncated, true);
  assert.match(r.stdout, /lines omitted/);
});

/**
 * A `sleep` invocation whose duration is unique to THIS test process, used
 * as the search pattern for counting survivors.
 *
 * Two independent requirements, both learned the hard way:
 *
 * 1. The marker has to sit in the *grandchild's own* argv. A trailing
 *    `# comment` lives only in the shell's argv, and the shell dies under
 *    every implementation — a comment-marker version of these tests went
 *    19/19 green against a mutant with the process-group kill removed
 *    entirely, while `pgrep -f "sleep 23"` proved the orphan was alive.
 *
 * 2. It has to be unique per run. With a fixed duration, an orphan left
 *    behind by an earlier crashed or killed run is indistinguishable from
 *    one this run leaked, and the test fails for the previous run's sins.
 *    Observed directly here: three consecutive suite runs reported a
 *    spurious failure until the leftovers from a mutation-testing run were
 *    reaped. Fractional seconds are accepted by both GNU and BSD `sleep`.
 */
function sleepMarker(seconds) {
  return `sleep ${seconds}.${process.pid}`;
}

// --- Additional tests added by the implementer for the three measured ----
// --- Critical defects (task-17-brief.md section B) and the two open   ----
// --- questions (section C). Not in the plan's own 8; required by the  ----
// --- controller's self-review checklist, which explicitly asks for    ----
// --- measured proof (survivor counts, memory growth), not just an     ----
// --- assertion that a flag flipped.                                   ----

// B1: spawn() throws SYNCHRONOUSLY for a command containing a NUL byte
// (measured against this exact Node/platform before writing the brief —
// see task-17-brief.md section B1). Task 16's adversarial review found
// `rm\0 -rf /` passes checkCommand (NUL breaks the safety rules' own
// adjacency matching), specifically ruling it "not exploitable" BECAUSE
// child_process refuses it downstream — so runCommand WILL be handed a
// NUL-containing command in practice, and must not let that turn into an
// unhandled promise rejection.
test('never rejects for a command containing a NUL byte (sync spawn throw)', async () => {
  const r = await runCommand('echo\0 hi', { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.equal(r.exitCode, null);
  assert.equal(r.timedOut, false);
  assert.equal(typeof r.durationMs, 'number');
});

// B1 (continued): a cwd that is a file, not a directory, is another sync
// spawn() throw path on at least one platform (measured: macOS raises
// ENOTDIR synchronously). Belt-and-braces alongside the NUL case above —
// both must produce a clean result object, not a rejection.
test('never rejects when cwd is a file rather than a directory', async () => {
  const fileCwd = new URL(import.meta.url).pathname; // this test file itself is a file, not a dir
  const r = await runCommand('echo hi', { cwd: fileCwd, timeoutMs: 10_000 });
  assert.equal(r.exitCode, null);
  assert.equal(r.timedOut, false);
});

// B1 (continued): a nonexistent cwd is a DIFFERENT failure shape than the
// two above -- confirmed during development that on this platform it
// raises an ASYNC 'error' event ("spawn /bin/sh ENOENT"), not a
// synchronous throw. Included anyway as an explicit regression test: the
// self-review checklist calls out "a nonexistent cwd" by name as one of
// the inputs to specifically try against the "never rejects" contract, and
// the async-vs-sync distinction is exactly the kind of platform-dependent
// behavior that's worth pinning down with a real assertion instead of
// trusting it stays that way.
test('never rejects when cwd does not exist', async () => {
  const r = await runCommand('echo hi', { cwd: '/does/not/exist/at/all/exec-test', timeoutMs: 10_000 });
  assert.equal(r.exitCode, null);
  assert.equal(r.timedOut, false);
});

// B1 (continued): a command string long enough to hit the OS's
// argument-length limit is a third confirmed synchronous spawn() throw
// (measured: E2BIG on this platform for a ~5MB command string) --
// different underlying cause than the NUL-byte and bad-cwd cases above,
// same contract to uphold.
test('never rejects for a command string long enough to hit an OS argument-length limit', async () => {
  const huge = `echo ${'a'.repeat(5_000_000)}`;
  const r = await runCommand(huge, { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.equal(r.exitCode, null);
  assert.equal(r.timedOut, false);
});

// Not a spawn-time failure at all -- a command that closes its own stdout
// mid-run (`exec 1>&-`) and then keeps writing to it. Included because the
// self-review checklist calls this out explicitly as a case to try against
// the "never rejects" contract: a write error on the child's side must not
// propagate as a rejection or an uncaught exception in this process either.
test('never rejects when the command closes its own stdout mid-run', async () => {
  const r = await runCommand('exec 1>&-; echo after-close-attempt; exit 7', { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.equal(r.exitCode, 7);
  assert.equal(r.timedOut, false);
});

// B2: the measured bug was specifically that SIGTERM to the shell alone
// leaves a *backgrounded grandchild* running (`sh -c "sleep 30 & wait"` ->
// orphaned "sleep 30" survives). This test reproduces that exact shape and
// COUNTS surviving processes afterward with `pgrep -f`, per the controller's
// explicit instruction not to just assert `timedOut === true`. A `finally`
// force-kills any stray survivor so a regression here can't leave a real
// sleep running on the dev machine across test runs.
//
// The marker MUST be something the grandchild itself carries in its own
// argv, which is why it is an unusual sleep duration rather than a trailing
// `# comment`. A comment lives only in the SHELL's argv, and the shell dies
// under either implementation -- so a comment-marker version of this test
// passes against an implementation with no process-group kill at all.
// Measured, not theorized: with the marker as a comment, `pgrep -f MARKER`
// returned 0 while `pgrep -f "sleep 23"` returned 1 -- the orphan was alive
// and the test could not see it, and the whole 18-test file went green
// against a mutant with `detached: true` removed and `kill(-pid)` reduced to
// `kill(pid)`.
test('kills a backgrounded grandchild left by a timed-out command', async () => {
  const marker = sleepMarker(24173); // the duration IS the marker: it lives in the grandchild's own argv
  try {
    const r = await runCommand(`${marker} & wait`, { cwd: tmpdir(), timeoutMs: 500 });
    assert.equal(r.timedOut, true);

    // Give the OS a moment to finish reaping the signaled process group —
    // the direct child's 'close' event (which resolves the promise above)
    // can land a beat before every other process in the same group has
    // fully processed the same signal. Measured during development: 400ms
    // is comfortably enough on this platform (bash repro settled in
    // well under that).
    await new Promise((resolve) => setTimeout(resolve, 400));

    let survivors = '';
    try {
      survivors = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' });
    } catch (err) {
      // pgrep exits 1 (no match) when nothing survived -- the expected,
      // passing case.
      assert.equal(err.status, 1, `pgrep failed unexpectedly: ${err.message}`);
    }
    assert.equal(survivors.trim(), '', `grandchild(ren) survived the timeout:\n${survivors}`);
  } finally {
    try {
      const leftover = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).trim();
      if (leftover) {
        for (const pid of leftover.split('\n')) execFileSync('kill', ['-9', pid]);
      }
    } catch {
      // pgrep exit 1 == nothing left to clean up.
    }
  }
});

// B2 (continued): the SIGTERM-then-SIGKILL escalation contract
// ("超时后先 SIGTERM，2 秒后仍在则 SIGKILL") only does observable work when
// something actually ignores SIGTERM -- `sleep` alone terminates on SIGTERM
// and never reaches the SIGKILL branch, so it can't prove escalation
// happens at all. This test's child traps SIGTERM (`trap '' TERM`) so it
// can *only* die via SIGKILL, then confirms (via pgrep, not just timedOut)
// that it is actually gone once the grace period elapses. Runtime is
// bounded (timeoutMs + the fixed kill grace period), not real 30s waits.
//
// Same marker discipline as the test above: the duration IS the marker, so
// this counts the SIGTERM-ignoring shell AND the grandchild it backgrounded,
// rather than only the one the pre-fix detection could see.
test('escalates to SIGKILL when the child ignores SIGTERM', async () => {
  const marker = sleepMarker(20719);
  try {
    const r = await runCommand(
      `trap '' TERM; ${marker} & wait`,
      { cwd: tmpdir(), timeoutMs: 300 },
    );
    assert.equal(r.timedOut, true);

    await new Promise((resolve) => setTimeout(resolve, 400));
    let survivors = '';
    try {
      survivors = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' });
    } catch (err) {
      assert.equal(err.status, 1, `pgrep failed unexpectedly: ${err.message}`);
    }
    assert.equal(survivors.trim(), '', `SIGTERM-ignoring process survived SIGKILL:\n${survivors}`);
  } finally {
    try {
      const leftover = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).trim();
      if (leftover) {
        for (const pid of leftover.split('\n')) execFileSync('kill', ['-9', pid]);
      }
    } catch {
      // nothing left to clean up
    }
  }
});

// The hang this module can least afford: a grandchild that BOTH escapes the
// process group (it is `detached`, so it leads a group of its own and the
// group kill cannot reach it) AND inherited the shell's stdout. Node's
// 'close' event waits for the pipes to reach EOF, not merely for the child
// to exit, so the squatter holds the promise open indefinitely. Measured on
// the pre-fix version: still pending 12 SECONDS after an 800ms timeout, with
// no upper bound at all -- the timeout fired and killed what it could reach,
// and the caller never learned about it.
//
// This is not an exotic shape. It is what `npm test` looks like when the
// suite starts a dev server, a docker container, or a background worker.
test('settles within a bounded time when a grandchild escapes the group holding stdout', async () => {
  const duration = `12071.${process.pid}`;
  const marker = `sleep ${duration}`;
  const spawnEscapee =
    `node -e 'require("child_process").spawn("sleep",["${duration}"],{detached:true,stdio:["ignore",1,2]}).unref()'`;
  try {
    const startedAt = Date.now();
    // The ceiling is deliberately 3s, not something roomier. Measured, three
    // runs each: the 'exit'-plus-drain path settles at 1.30s (800ms timeout +
    // the 500ms drain), while removing that path and leaving only 'close'
    // settles at 4.81s — the SIGKILL backstop eventually mops it up, two
    // escalation steps later. A 5s ceiling therefore passes against BOTH,
    // testing nothing; it was the first thing tried here and a mutant with
    // the 'exit' handler deleted went 19/19 green under it. 3s sits 2.3x
    // above the real path and 1.6x below the backstop path, so it isolates
    // the fix under test instead of silently accepting its absence.
    const r = await Promise.race([
      runCommand(`${spawnEscapee}; ${marker}`, { cwd: tmpdir(), timeoutMs: 800 }),
      new Promise((resolve) => setTimeout(() => resolve('PENDING'), 3000)),
    ]);
    assert.notEqual(r, 'PENDING', 'runCommand never settled promptly — it hung past its own timeout');
    assert.equal(r.timedOut, true);
    assert.ok(Date.now() - startedAt < 3000);
  } finally {
    // The escapee is deliberately out of reach of the module's own cleanup —
    // by construction, nothing runCommand does can kill it — so the test that
    // created it has to.
    try {
      const leftover = execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).trim();
      if (leftover) for (const pid of leftover.split('\n')) execFileSync('kill', ['-9', pid]);
    } catch {
      // pgrep exit 1 == nothing left to clean up.
    }
  }
});

// B3: proves memory is bounded DURING collection, not just that the final
// text is short (a buggy accumulate-everything-then-truncate
// implementation would *also* produce a short final string -- the bug is
// the unbounded peak in between, so the assertion has to be about actual
// process memory growth, measured against a genuinely high-volume
// producer). `yes` is the exact command measured in task-17-brief.md
// section B3 (1168 MB in 2 seconds on this class of machine); this test
// runs it for ~1.2s under a bounded timeout and asserts this process's own
// RSS did not grow anywhere near that -- a generous 150 MB ceiling, more
// than 10x below what an unbounded accumulator would produce even in the
// truncated ~1.2s window, so this cannot pass by accident.
test('bounds memory while collecting output from a high-volume producer', async () => {
  if (global.gc) global.gc();
  const before = process.memoryUsage().rss;
  const r = await runCommand('yes "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', {
    cwd: tmpdir(),
    timeoutMs: 1200,
  });
  const after = process.memoryUsage().rss;
  const grownBytes = after - before;

  assert.equal(r.timedOut, true);
  assert.equal(r.truncated, true);
  assert.match(r.stdout, /omitted/);
  // The captured/returned text itself must also be small -- not just
  // "eventually truncated" after an unbounded intermediate string existed.
  assert.ok(r.stdout.length < 2_000_000, `returned stdout unexpectedly large: ${r.stdout.length} chars`);
  assert.ok(
    grownBytes < 150 * 1024 * 1024,
    `process RSS grew by ${(grownBytes / 1024 / 1024).toFixed(1)} MB collecting output, expected a bounded amount`,
  );
});

// C2 (open question, verified not guessed): with stdio's stdin set to
// 'ignore', a command that reads from stdin gets an immediate EOF (the fd
// is connected to /dev/null on POSIX) rather than hanging until the
// timeout. `cat` with no input echoes nothing and exits 0 almost
// immediately; if this were wrong (stdin hanging), this test would only
// pass by hitting the timeout floor instead of finishing well under it.
test('a command reading stdin gets immediate EOF rather than hanging', async () => {
  const r = await runCommand('cat', { cwd: tmpdir(), timeoutMs: 10_000 });
  assert.equal(r.exitCode, 0);
  assert.equal(r.timedOut, false);
  assert.equal(r.stdout, '');
  assert.ok(r.durationMs < 5000, `cat took ${r.durationMs}ms against a 10s timeout -- looks like it hung on stdin`);
});

// C1 (open question, judgment call documented in exec.mjs and the report):
// this implementation deliberately makes HARNESS_VERIFY/CI non-overridable
// by caller-supplied env, while still letting caller env override every
// other variable. This test locks that decision in as a regression test
// rather than leaving it as an implicit, unverified side effect of merge
// order.
test('caller-supplied env cannot override HARNESS_VERIFY or CI, but can override other vars', async () => {
  const r = await runCommand('echo $HARNESS_VERIFY,$CI,$MY_VAR', {
    cwd: tmpdir(),
    timeoutMs: 10_000,
    env: { HARNESS_VERIFY: '0', CI: 'false', MY_VAR: 'custom' },
  });
  assert.equal(r.stdout.trim(), '1,1,custom');
});
