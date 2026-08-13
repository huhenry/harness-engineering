/**
 * Timeout-bounded command execution. This is the only module in the
 * project that actually calls `spawn` on a child process. `safety.mjs`
 * decides which commands are allowed to reach this file at all
 * (`checkCommand` first); `runCommand` decides how a permitted command
 * runs. Deliberately no safety logic here — two copies of that logic in
 * two places is exactly the drift class safety.mjs's own header comment
 * describes; keeping the boundary hard is worth more than a "just in
 * case" second check that could quietly diverge from the real one.
 *
 * Three Critical defects were measured in the plan's own skeleton before
 * this module was written (task-17-brief.md section B) and are fixed here
 * as B1/B2/B3 below — see each one's own comment for the measurement and
 * the fix.
 *
 * This module models POSIX/bash shell semantics only (matching
 * safety.mjs's stated scope, not Windows) — `spawn(cmd, {shell:true})`
 * already ties execution to the platform's default shell, and B2's
 * process-group kill (`detached` + a negative pid) is POSIX-specific by
 * construction.
 */

import { spawn } from 'node:child_process';
import { hrtime } from 'node:process';

const DEFAULT_TIMEOUT_MS = 300_000;

// "超时后先 SIGTERM，2 秒后仍在则 SIGKILL" (plan's own constraint, task-17-
// brief-raw.md). Long enough for an ordinary process to unwind cleanly on
// SIGTERM (close files, flush output); short enough that a verify run
// doesn't sit around waiting on something that has already decided not to
// cooperate.
const KILL_GRACE_MS = 2000;

// How long to keep reading stdout/stderr after the direct child has already
// exited, before settling anyway. See the 'exit' handler in `runCommand` for
// the measured hang this bounds. Only ever paid when something OTHER than the
// child still holds the pipes open — in the ordinary case EOF arrives in the
// same breath as the exit and this timer is cleared before it can fire.
const EXIT_DRAIN_MS = 500;

// Last-resort settle after SIGKILL has already been delivered. SIGKILL cannot
// be caught or ignored, so a process still alive after it is stuck in
// uninterruptible IO (D state) — rare, but this module's entire contract is
// "bounded", and "bounded except for one kernel state" is not bounded.
const KILL_BACKSTOP_MS = 2000;

// B3 (measured, task-17-brief.md): accumulating a whole stream into one
// string and truncating only at the end lets a talkative command outrun
// truncateOutput entirely -- `yes "<40 chars>"` produced 1168 MB in 2
// seconds, ~171 GB extrapolated over the 300s default timeout, long before
// truncateOutput would ever get a chance to run. CAPTURE_CAP_CHARS bounds
// how much of ONE stream (stdout or stderr) this module holds in memory at
// once, independent of how much the child actually writes -- see
// BoundedCollector below. Sized generously above the default 100+100 line
// budget (assuming lines aren't each many KB) while staying tiny relative
// to what an unbounded producer could dump: worst case per stream is
// roughly 2x this (a frozen head plus a rolling tail), not the full
// output.
const CAPTURE_CAP_CHARS = 256 * 1024; // 256 Ki JS chars per stream, per side

/** Keep the head and tail of long output so reports stay readable. */
export function truncateOutput(text, headLines = 100, tailLines = 100) {
  const lines = text.split('\n');
  if (lines.length <= headLines + tailLines) return { text, truncated: false };
  const omitted = lines.length - headLines - tailLines;
  return {
    text: [
      ...lines.slice(0, headLines),
      `... ${omitted} lines omitted ...`,
      ...lines.slice(-tailLines),
    ].join('\n'),
    truncated: true,
  };
}

/**
 * B3's actual fix. Holds a frozen head prefix plus a rolling tail window
 * for one stream, each capped at `CAPTURE_CAP_CHARS`, so the amount held in
 * memory never grows with how much the child writes. `totalChars` is a
 * running counter (O(1) memory) used only to report an honest
 * omitted-amount, never to reconstruct the dropped middle.
 *
 * Two designs were on the table: drop-or-stop entirely once the cap is
 * hit, or bound-and-continue. Chose bound-and-continue (keep collecting a
 * rolling tail even past the cap) because the tail of a talkative
 * command's output is usually the informative part (the final error, the
 * summary line) — stopping collection outright at the cap would silently
 * lose exactly that, in favor of the *middle* of a giant dump nobody
 * asked to see either.
 */
class BoundedCollector {
  #capChars;
  #head = '';
  #headFrozen = false;
  #tail = '';
  #totalChars = 0;
  #droppedMiddle = false;

  constructor(capChars = CAPTURE_CAP_CHARS) {
    this.#capChars = capChars;
  }

  push(chunk) {
    this.#totalChars += chunk.length;

    if (!this.#headFrozen) {
      this.#head += chunk;
      if (this.#head.length >= this.#capChars) this.#headFrozen = true;
    } else {
      this.#droppedMiddle = true;
    }

    // Rolling tail: always keep appending, then trim from the front so
    // this string's own size never exceeds the cap either. This is what
    // keeps memory bounded even while `push` is still being called --
    // trimming happens on every call, not just at the end.
    this.#tail += chunk;
    if (this.#tail.length > this.#capChars) {
      this.#tail = this.#tail.slice(this.#tail.length - this.#capChars);
    }
  }

  /**
   * Final {text, truncated} shape once the child is done. When the cap was
   * never hit, `#head` IS the complete stream (the parallel `#tail` buffer
   * is redundant in that case, bounded the same way `#head` is), so this
   * hands off to the existing line-based `truncateOutput` unchanged --
   * short/medium output behaves exactly as already tested, unaffected by
   * the cap's existence.
   */
  finalize(headLines = 100, tailLines = 100) {
    if (!this.#droppedMiddle) return truncateOutput(this.#head, headLines, tailLines);

    // The cap was hit: `#head` and `#tail` are each already bounded
    // (<= capChars), so it's safe to line-split just these two small
    // pieces now -- the unbounded middle was never materialized as a full
    // string at any point, which is the whole point of this class. The
    // exact omitted *line* count for that middle isn't knowable without
    // having buffered it (the thing this class exists to avoid), so this
    // reports chars omitted instead -- an honest number from the O(1)
    // running counter, rather than a fabricated line count.
    const headLinesText = this.#head.split('\n').slice(0, headLines);
    const tailLinesText = this.#tail.split('\n').slice(-tailLines);
    const kept = headLinesText.join('\n').length + tailLinesText.join('\n').length;
    const omittedChars = Math.max(this.#totalChars - kept, 0);
    return {
      text: [
        ...headLinesText,
        `... output exceeded ${this.#capChars} chars per side; ~${omittedChars} chars omitted ...`,
        ...tailLinesText,
      ].join('\n'),
      truncated: true,
    };
  }
}

function elapsedMs(started) {
  return Number((hrtime.bigint() - started) / 1_000_000n);
}

/**
 * Send `signal` to the whole process group `child` leads, not just `child`
 * itself.
 *
 * B2 (measured, task-17-brief.md): `spawn(cmd, {shell:true})` starts
 * `sh -c cmd`, and a plain `child.kill()` signals only that shell process.
 * Measured: `sh -c "sleep 30 & wait"` left an orphaned `sleep 30` running
 * after SIGTERM to the shell -- a background job the shell forked is a
 * *sibling* in the process tree once backgrounded with `&`, not a
 * descendant `child.kill()` can reach. Real-world impact called out in the
 * brief: `npm test` forks node, node forks workers; "timed out" would
 * silently leave orphans holding CPU/ports while the report claims
 * termination.
 *
 * Fix: `runCommand` spawns with `detached: true`, which on POSIX makes the
 * child the leader of a new process group (its pgid equals its pid).
 * Signaling the *negative* pid (`process.kill(-pid, signal)`) delivers the
 * signal to every process in that group directly from the kernel -- not
 * relayed through the shell -- which is what actually reaches a
 * backgrounded grandchild. Verified empirically (not just reasoned about):
 * `sh -c "sleep 30 & wait"` + `process.kill(-pid, 'SIGTERM')`, checked via
 * `pgrep -f "sleep 30"` 500ms later, left zero survivors.
 *
 * `process.kill` throws `ESRCH` if the group is already gone by the time
 * this runs (e.g. the child exited on its own between the timeout firing
 * and this call, or SIGKILL races a SIGTERM that already worked) --
 * confirmed by direct reproduction during development. That is an
 * ordinary race, not a bug: swallow it rather than let cleanup itself
 * become a new uncaught exception (the brief calls this out explicitly).
 *
 * Also swallow `EPERM`, found by a targeted stress test written for this
 * module's own self-review (200 concurrent short-lived commands racing a
 * 1ms timeout): the identical "arrived too late" race can surface as
 * EPERM instead of ESRCH when the OS reuses a just-freed pid for some
 * *other*, unrelated process (owned by a different session/daemon, not a
 * descendant of this one) in the gap between "the timer decided to kill
 * pid N's group" and "the kill() syscall actually runs" -- signaling a
 * process group we never spawned and don't own is denied, not "not
 * found". Reproduced directly: 200 rapid `spawn` + 1ms-delayed
 * `kill(-pid, SIGTERM)` produced 196 EPERM / 0 ESRCH, versus the same kill
 * issued from a `child.on('close', ...)` handler (no reuse window)
 * producing 0 EPERM / 50 ESRCH across 50 runs. Safe to swallow here
 * specifically because every pid this function is ever called with was
 * one this module spawned itself moments earlier as its own process-group
 * leader (see `runCommand`'s `detached: true`) -- there is no legitimate
 * scenario in this module where EPERM means "you tried to kill something
 * you were never allowed to touch"; it only means "the number you
 * remember doesn't refer to your child anymore." Any other error code is
 * rethrown -- this must not become a blanket try/ignore around process
 * control.
 */
function killProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (err) {
    if (err.code !== 'ESRCH' && err.code !== 'EPERM') throw err;
  }
}

/**
 * Run one command. Callers MUST have cleared it through safety.mjs's
 * `checkCommand` first — this function performs no safety checks of its
 * own (see the file-level comment). Never rejects: every failure path,
 * including one that only exists because `spawn` itself throws
 * synchronously for certain inputs (see B1 below), resolves to a result
 * object with `exitCode: null` instead.
 *
 * Env merge order is `{...process.env, ...env, HARNESS_VERIFY: '1',
 * CI: '1'}` — deliberately NOT `{...process.env, HARNESS_VERIFY, CI,
 * ...env}` as the plan originally had it (open question C1, task-17-
 * brief.md: "调用方传的 env 能覆盖 HARNESS_VERIFY. 这是有意的还是隐患？").
 * Judgment: a hazard, not an intentional feature. `safety.mjs`'s own
 * header frames the whole surface this module serves as "a command
 * declared in *someone else's repository's* AGENTS.md" — untrusted input.
 * A future caller building `env` from anything config-derived (a
 * `harness.config.json` field, say) could let a hostile repo strip its own
 * "I am being verified" signal, e.g. to behave differently when
 * unobserved. Caller-supplied env can still override *everything else*
 * (PATH, credentials, whatever a real caller legitimately needs to set) —
 * only these two specific markers are pinned so they are unconditionally
 * trustworthy to any script that checks them.
 */
export function runCommand(cmd, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env = {} } = {}) {
  const started = hrtime.bigint();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, {
        shell: true,
        cwd,
        env: { ...process.env, ...env, HARNESS_VERIFY: '1', CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        // See killProcessGroup's comment: this is what makes a
        // process-group-wide signal possible at all.
        detached: true,
      });
    } catch (err) {
      // B1 (measured, task-17-brief.md): `spawn` throws SYNCHRONOUSLY, not
      // via the usual async 'error' event, for at least three inputs
      // confirmed on this platform during development: a command
      // containing a NUL byte ("The argument 'file' must be a string
      // without null bytes"), a `cwd` that is a file rather than a
      // directory (ENOTDIR), and a command string long enough to hit the
      // OS's argument-length limit (E2BIG). Calling `spawn` directly
      // inside the `new Promise` executor, as the plan's skeleton did,
      // means any of these turns into a *rejection*, breaking this
      // function's own documented "never rejects" contract. This path is
      // not hypothetical: Task 16's adversarial safety review confirmed
      // `rm\0 -rf /` passes `checkCommand` (the NUL byte breaks the safety
      // rules' own adjacency matching) and was ruled non-exploitable
      // PRECISELY BECAUSE child_process refuses it downstream -- meaning
      // this exact catch block is the thing standing between that finding
      // and a real unhandled rejection in Task 18's verify run.
      resolve({
        command: cmd,
        exitCode: null,
        timedOut: false,
        durationMs: elapsedMs(started),
        stdout: '',
        stderr: `${err.message}\n`,
        truncated: false,
      });
      return;
    }

    const stdoutCollector = new BoundedCollector();
    const stderrCollector = new BoundedCollector();
    let timedOut = false;
    let settled = false;
    let hardTimer = null;
    let drainTimer = null;
    let backstopTimer = null;

    const softTimer = setTimeout(() => {
      if (settled) return; // defensive: a 'close' racing this timer already won
      timedOut = true;
      killProcessGroup(child.pid, 'SIGTERM');
      hardTimer = setTimeout(() => {
        if (settled) return;
        killProcessGroup(child.pid, 'SIGKILL');
        backstopTimer = setTimeout(() => finish(null), KILL_BACKSTOP_MS);
      }, KILL_GRACE_MS);
    }, timeoutMs);

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      for (const t of [softTimer, hardTimer, drainTimer, backstopTimer]) clearTimeout(t);
      // Explicitly drop the stdio handles rather than waiting for GC. When a
      // surviving process still holds the write end of these pipes, the read
      // ends stay ref'd in this process's event loop, and node will not exit
      // even though the promise has resolved -- the caller (Task 18's verify)
      // would print its report and then hang at exit for as long as the
      // squatter lives. Harmless in the ordinary path: 'close' means both
      // streams already reached EOF, so this is a no-op there.
      child.stdout.destroy();
      child.stderr.destroy();
      const out = stdoutCollector.finalize();
      const err = stderrCollector.finalize();
      resolve({
        command: cmd,
        exitCode,
        timedOut,
        // Real wall-clock duration (hrtime), not part of the project's
        // byte-for-byte determinism contract -- see task-17-brief.md
        // section D. Task 18's verify report will differ run to run on
        // this field specifically; that's expected, not a bug.
        durationMs: elapsedMs(started),
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
      });
    };

    child.stdout.on('data', (d) => stdoutCollector.push(d.toString()));
    child.stderr.on('data', (d) => stderrCollector.push(d.toString()));
    // A late async 'error' (e.g. the shell itself failing to launch --
    // confirmed reproducible via a nonexistent cwd, which raises ENOENT
    // this way rather than synchronously) has no exit code to report.
    child.on('error', (err) => {
      stderrCollector.push(`${err.message}\n`);
      finish(null);
    });
    // 'exit' and 'close' are NOT the same event, and the difference is a
    // measured indefinite hang, not a nicety. 'close' fires only once the
    // child has exited AND both stdio pipes have reached EOF. Any process
    // that inherited the child's stdout/stderr keeps those pipes open after
    // the child itself is gone, so 'close' alone can wait forever -- and
    // `detached: true` grandchildren (a daemon a test command starts, a
    // background worker, a dev server) escape the process-group kill above
    // by design, because they lead a group of their own.
    //
    // Measured on the pre-fix version of this file: a command whose
    // grandchild both escaped the process group and inherited stdout was
    // still pending 12 seconds after an 800ms timeout, with no upper bound.
    // A module named "timeout-bounded execution" hanging past its own
    // timeout is the single worst failure it can have -- Task 18's verify
    // would sit there producing nothing, on a command the target repository
    // declared and this tool merely agreed to run.
    //
    // So settle on the direct child's exit, allowing only a short bounded
    // window for output still in flight. Whichever of the two events lands
    // first wins; `finish` is idempotent.
    child.on('exit', (code) => {
      if (settled) return;
      drainTimer = setTimeout(() => finish(timedOut ? null : code), EXIT_DRAIN_MS);
    });
    child.on('close', (code) => finish(timedOut ? null : code));
  });
}
