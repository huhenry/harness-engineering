#!/usr/bin/env node
/**
 * This module is where the project's central claim gets cashed in. The
 * upstream `harness-creator` tooling can only ever *say* which verification
 * commands a repository should have; the one hard difference this project
 * makes is that `verify --run` actually spawns them and actually records
 * what happened, and `assess` (Task 15) uses that record to decide whether
 * Feedback can reach 3 and the repo can reach L4.
 *
 * So the JSON this module writes is not a log — it is evidence. The first
 * property evidence must have is honesty: a command that was never run must
 * never be reported as having failed, and a command that really did fail
 * must never be reported as unexecuted. That contract ("missing evidence !=
 * negative evidence") is what the rest of this project has been built
 * around since Task 1; see verify-status.mjs for the shared vocabulary that
 * keeps this module and feedback.mjs from silently disagreeing about it.
 *
 * Data flow: config.verify (Task 9) -> checkCommand (Task 16) -> runCommand
 * (Task 17) -> .harness/verify-report.json -> assess's loadEvidence (Task
 * 15) -> the feedback/environment scorers.
 */
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, resolveRepoPath, CliError } from './lib/cli.mjs';
import { assertLang, t } from './lib/i18n.mjs';
import { createScanContext } from './lib/scan.mjs';
import { loadConfig, VERIFY_ROLES } from './lib/config.mjs';
import { checkCommand, reasonKeyFor } from './lib/safety.mjs';
import { runCommand } from './lib/exec.mjs';
import { VERIFY_STATUS } from './lib/verify-status.mjs';

export const SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 300_000;

// Node's setTimeout silently truncates any delay above INT32_MAX
// (2^31 - 1 ms, ~24.86 days) instead of throwing — it fires almost
// immediately and (depending on Node version) prints a
// TimeoutOverflowWarning that a non-interactive `verify --run` invocation
// will never be watched closely enough to notice. Task-18-brief.md section
// B2 measured the sibling bug directly: an unvalidated `--timeout abc`
// becomes `Number('abc')` -> `NaN`, and `setTimeout(cb, NaN)` fires after 0
// ms — every declared command gets recorded as `timeout` in the very
// evidence file `assess` reads to decide whether Feedback can reach 3, and
// the user has no way to tell "the tool broke" apart from "my tests are
// slow". An oversized --timeout reaches the identical failure shape (every
// command times out instantly, and it gets written down as if it were
// real) through a different door, so it gets the same fail-closed
// treatment as non-numeric, zero, and negative input — see
// parseTimeoutSeconds below.
const MAX_TIMEOUT_MS = 2_147_483_647;

function emptyEntry(role, command, source) {
  return {
    role,
    command,
    source,
    status: VERIFY_STATUS.PLANNED,
    exitCode: null,
    durationMs: 0,
    stdout: '',
    stderr: '',
    truncated: false,
    blockedBy: null,
    // Task-18-brief.md section B3: checkCommand's `overriddenBy` tells the
    // caller "this would have been blocked by rule X, but your --allow
    // pattern let it through" — the entire reason Task 16 returns that
    // field at all (task-16-report.md section C). The plan's own verify
    // skeleton read only `safety.blocked`/`safety.patternId` and let this
    // evaporate, breaking the "the user can accept risk, but not
    // unknowingly" promise at its one and only call site. Defaulting it
    // here (rather than only ever assigning it in one branch) means every
    // entry — blocked, planned, executed — carries an explicit answer
    // instead of an entry that merely happens not to have the field.
    overriddenBy: null,
  };
}

/**
 * `--timeout` is documented in seconds (`[--timeout <sec>]`); `runCommand`
 * wants milliseconds. Mirrors `assess.mjs`'s `parseMinLevel`: any input
 * that doesn't cleanly mean "a positive number of seconds, safely
 * convertible to a bounded millisecond delay" is a usage error (exit 2),
 * never a silent NaN/Infinity that produces fabricated evidence — see the
 * MAX_TIMEOUT_MS comment above for why the upper bound is exactly as
 * load-bearing as the lower one.
 */
function parseTimeoutSeconds(raw) {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  // Deliberately does not accept a leading '-', scientific notation, or
  // Infinity/NaN spellings: a plain, unambiguous non-negative decimal is
  // the only shape this flag needs to support, and rejecting everything
  // else outright is simpler and safer than special-casing each one.
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new CliError(`Invalid --timeout '${raw}': expected a positive number of seconds.`);
  }
  const seconds = Number(raw);
  // The regex already excludes negative numbers; this catches the other
  // way "not a positive number" can happen — exactly zero, which is
  // syntactically a valid match for \d+ but a degenerate timeout that
  // could never let any command run at all.
  if (!(seconds > 0)) {
    throw new CliError(`Invalid --timeout '${raw}': must be greater than zero.`);
  }
  const ms = seconds * 1000;
  if (ms > MAX_TIMEOUT_MS) {
    throw new CliError(
      `Invalid --timeout '${raw}': exceeds the maximum supported timeout `
      + `(~${Math.floor(MAX_TIMEOUT_MS / 1000)}s) — larger values overflow `
      + 'Node\'s setTimeout and would silently time out every command '
      + 'instantly instead of running them.',
    );
  }
  return ms;
}

/** Compile every `--allow` value to a RegExp up front, the same shape
 * `checkCommand` expects — an invalid pattern is a usage error (exit 2),
 * matching `--min-level`'s and `--timeout`'s own convention, not a runtime
 * surprise half way through the verify loop. */
function parseAllowPatterns(raw) {
  if (raw === undefined) return [];
  return raw.map((value) => {
    try {
      return new RegExp(value);
    } catch (err) {
      throw new CliError(`Invalid --allow pattern '${value}': ${err.message}`);
    }
  });
}

/**
 * Make sure `.harness/` has its own `.gitignore` before this run's report
 * lands in it.
 *
 * Design judgment (task-18-brief.md section C1): the report embeds the
 * literal stdout/stderr of whatever commands a repository declares, and any
 * real project's test/build output routinely contains tokens, connection
 * strings, or internal hostnames — this is a tool meant to be handed to
 * strangers' repositories, so the default has to hold up without anyone
 * reading a warning first. Automatic redaction was considered and rejected:
 * there is no pattern-matching rule for "this looks like a secret" that
 * doesn't also miss real secrets (false negatives) or mangle legitimate
 * output (false positives) — either way the report stops being trustworthy
 * evidence, which is the one property this module exists to guarantee.
 * Keeping `.harness/` out of git is the mitigation that actually works
 * unconditionally: content that is never staged cannot leak through a
 * commit. Never overwrites an existing `.gitignore` — a user who already
 * customized one (e.g. to deliberately track verify-report.json in CI) had
 * that choice respected, not silently reverted on every `--run`.
 */
function ensureGitignore(harnessDir) {
  const path = join(harnessDir, '.gitignore');
  if (existsSync(path)) return;
  writeFileSync(path, '*\n');
}

/**
 * Run every role's declared command (dry-run) or actually execute it
 * (`run: true`), and assemble the evidence report. Pure modulo the two
 * documented exceptions: `now` is caller-supplied (no `Date.now()` in this
 * function), and `--run` performs real filesystem/process I/O — see
 * task-18-brief.md section E for why `durationMs` is this project's one
 * accepted non-determinism (real wall-clock time), so two `--run`s of the
 * same repo will not produce byte-identical JSON.
 */
export async function runVerify({
  repoPath, run = false, timeoutMs = DEFAULT_TIMEOUT_MS,
  allowPatterns = [], configPath, now,
}) {
  const ctx = createScanContext(repoPath);
  const config = loadConfig(ctx, { configPath });
  const commands = [];

  for (const role of VERIFY_ROLES) {
    const cmd = config.verify[role];
    if (!cmd) continue;
    const entry = emptyEntry(role, cmd, config.source);
    // Hard ordering (task-18-brief.md section E, exec.mjs's own file-level
    // comment): checkCommand MUST run before runCommand ever gets a chance
    // to exist. This call happens unconditionally, in every mode — a
    // dry-run still needs to know (and report) which of its planned
    // commands would have been blocked.
    const safety = checkCommand(cmd, allowPatterns);
    entry.overriddenBy = safety.overriddenBy;
    if (safety.blocked) {
      // Blocked commands are never spawned, in any mode — see section D.
      entry.status = VERIFY_STATUS.BLOCKED;
      entry.blockedBy = safety.patternId;
      commands.push(entry);
      continue;
    }
    if (!run) { commands.push(entry); continue; }
    const result = await runCommand(cmd, { cwd: repoPath, timeoutMs });
    // exitCode === null is runCommand's way of saying "this never actually
    // ran to completion" — a spawn-time failure it swallowed rather than
    // rejecting on (see exec.mjs's B1). timedOut takes priority when both
    // could apply (a timeout kill can itself leave exitCode null), and a
    // null, non-timed-out exitCode still counts as FAILED: the command was
    // attempted and did not produce a clean success, which is exactly what
    // FAILED means here — there is no fourth "attempted but unknown" status
    // for evidence to hide in.
    Object.assign(entry, {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
      status: result.timedOut
        ? VERIFY_STATUS.TIMEOUT
        : (result.exitCode === 0 ? VERIFY_STATUS.PASSED : VERIFY_STATUS.FAILED),
    });
    commands.push(entry);
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    repo: repoPath,
    generatedAt: now.toISOString(),
    mode: run ? 'run' : 'dry-run',
    commands,
    // A BLOCKED command fails the gate exactly like a FAILED one: the user
    // still does not have a passing verification for that role, and this
    // tool declining to run it does not change that fact. A PLANNED entry
    // does not fail the gate, because dry-run's entire contract is
    // "nothing ran yet, by design" — see the status semantics table
    // (task-18-brief-raw.md) and verify-status.mjs.
    passed: commands.every((c) => c.status === VERIFY_STATUS.PASSED || c.status === VERIFY_STATUS.PLANNED),
  };

  if (run) {
    // dry-run must not create so much as an empty directory — see section D
    // ("dry-run 一个字节都不许写") — so both of these only ever run inside
    // this `if (run)` branch, never unconditionally.
    const harnessDir = join(repoPath, '.harness');
    mkdirSync(harnessDir, { recursive: true });
    ensureGitignore(harnessDir);
    writeFileSync(join(harnessDir, 'verify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function statusLabel(status, lang) {
  return t(`verify.status.${status}`, lang);
}

function renderCommandsTable(commands, lang) {
  const lines = [
    `## ${t('verify.commands.heading', lang)}`,
    '',
    `| ${t('verify.col.role', lang)} | ${t('verify.col.command', lang)} | ${t('verify.col.status', lang)} |`,
    '| --- | --- | --- |',
  ];
  for (const c of commands) {
    lines.push(`| ${c.role} | \`${c.command}\` | ${statusLabel(c.status, lang)} |`);
  }
  lines.push('');
  return lines;
}

// Section D: "被阻断的命令在任何模式下都不执行", and the human-readable
// output must call this out on its own, not bury it inside the table —
// this is the section a user reads to find out *why* a declared command
// never ran.
function renderBlockedSection(commands, lang) {
  const blocked = commands.filter((c) => c.status === VERIFY_STATUS.BLOCKED);
  if (blocked.length === 0) return [];
  const lines = [`## ${t('verify.blocked.heading', lang)}`, ''];
  for (const c of blocked) {
    const reasonKey = reasonKeyFor(c.blockedBy);
    const reason = reasonKey ? t(reasonKey, lang) : c.blockedBy;
    lines.push(`- \`${c.role}\` (\`${c.command}\`): ${reason}`, '');
  }
  return lines;
}

// B3: a command that ran (or is planned to run) only because the user
// explicitly bypassed a safety rule with --allow is not an ordinary pass —
// it is a risk the user chose to accept, and this report must say so where
// it will actually be seen, not as a footnote sitting next to a normal
// green result.
function renderOverriddenSection(commands, lang) {
  const overridden = commands.filter((c) => c.overriddenBy);
  if (overridden.length === 0) return [];
  const lines = [`## ${t('verify.overridden.heading', lang)}`, ''];
  for (const c of overridden) {
    lines.push(t('verify.overridden.warning', lang, { role: c.role, command: c.command, rule: c.overriddenBy }), '');
  }
  return lines;
}

/**
 * Human-readable rendering. Section C2 (task-18-brief.md): a repository
 * with zero declared commands gets `passed: true` in the JSON (vacuously —
 * nothing failed because nothing ran), and that is correct for the exit
 * code and for `assess`'s gate logic (L4 still requires real evidence
 * elsewhere, so this cannot be gamed into a false pass at the level that
 * matters). But "passed" read on its own, without qualification, implies
 * "verified", and zero commands is not verification — it is the absence of
 * anything that could have been checked. The machine-readable JSON stays
 * simple (no new field — `commands.length === 0` already says everything a
 * consumer needs), and the prose carries the nuance instead: this render
 * path never emits the commands table or a bare "Result: PASSED" for that
 * case, only the explicit noCommands note.
 */
function renderVerifyMarkdown(report, lang) {
  const lines = [`# ${t('verify.title', lang)}`, ''];
  lines.push(t(report.mode === 'run' ? 'verify.mode.run' : 'verify.mode.dryRun', lang), '');

  if (report.commands.length === 0) {
    lines.push(t('verify.noCommands.note', lang), '');
    return lines.join('\n');
  }

  lines.push(t(report.passed ? 'verify.result.passed' : 'verify.result.failed', lang), '');
  lines.push(...renderCommandsTable(report.commands, lang));
  lines.push(...renderBlockedSection(report.commands, lang));
  lines.push(...renderOverriddenSection(report.commands, lang));

  if (report.mode === 'dry-run') {
    lines.push(t('verify.runHint', lang), '');
  } else {
    lines.push(t('verify.reportWritten', lang, { path: join(report.repo, '.harness', 'verify-report.json') }), '');
  }

  return lines.join('\n');
}

async function main(argv) {
  const { values, positionals } = parseCli(argv, {
    options: {
      run: { type: 'boolean', default: false },
      timeout: { type: 'string' },
      json: { type: 'boolean', default: false },
      lang: { type: 'string' },
      allow: { type: 'string', multiple: true },
    },
    allowPositional: true,
  });

  // Every flag is validated before any command is touched — an invalid
  // --timeout or --allow must exit 2 even for a repo that declares zero
  // verification commands, the same "fail on the usage error, not the
  // absence of work" ordering assess.mjs's --min-level uses.
  const timeoutMs = parseTimeoutSeconds(values.timeout);
  const allowPatterns = parseAllowPatterns(values.allow);
  const repoPath = resolveRepoPath(positionals, process.cwd());
  const ctx = createScanContext(repoPath);
  const lang = assertLang(values.lang ?? loadConfig(ctx).lang);

  const report = await runVerify({
    repoPath, run: values.run, timeoutMs, allowPatterns, now: new Date(),
  });

  const output = values.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderVerifyMarkdown(report, lang)}\n`;
  process.stdout.write(output);

  return report.passed ? 0 : 1;
}

// See assess.mjs's identical function for the full reasoning (symlinked
// /tmp on macOS, spaces/unicode in the path, why a hand-built file:// URL
// or pathToFileURL alone both fail this check on their own) — copied
// verbatim rather than imported, since it is script-entry-point logic, not
// library code that belongs under scripts/lib/.
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // main() is async (runVerify awaits child processes), unlike assess.mjs's
  // synchronous main() — so the top-level dispatch is a promise chain
  // rather than a try/catch, but the exit-code contract is identical: a
  // CliError is a usage error (its own exitCode, 2); anything else is an
  // unexpected internal failure (3), never confused with a real gate
  // failure (1, produced by main()'s own returned code) or a usage error.
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof CliError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(err.exitCode);
      }
      process.stderr.write(`${err.stack ?? err.message}\n`);
      process.exit(3);
    },
  );
}
