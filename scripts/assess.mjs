#!/usr/bin/env node
import { writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCli, resolveRepoPath, CliError } from './lib/cli.mjs';
import { assertLang } from './lib/i18n.mjs';
import { createScanContext } from './lib/scan.mjs';
import { loadConfig } from './lib/config.mjs';
import { detectStack } from './lib/stack.mjs';
import { SCORERS } from './lib/scorers/index.mjs';
import { buildReport, renderMarkdown, allGaps } from './lib/report.mjs';
import {
  applyDiagnosticOverlay,
  assertProfile,
  DEFAULT_PROFILE,
  profileOverlay,
} from './lib/profiles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function toolVersion() {
  try {
    return JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  } catch { return '0.0.0-dev'; }
}

/**
 * Load a verify report and classify it, always. `reason` is the report's
 * public, stable, machine-readable explanation for why evidence did or did
 * not take effect — `null` only when it did. It distinguishes:
 *
 *   - 'missing'          no .harness/verify-report.json (or unreadable /
 *                        unparseable — ScanContext.readJson collapses both
 *                        to null, so this tool cannot tell them apart; that
 *                        is a scan.mjs contract, not something loadEvidence
 *                        can improve on).
 *   - 'schemaMismatch'   present, but schemaVersion !== 1.
 *   - 'invalidTimestamp' generatedAt does not parse, OR is later than `now`.
 *                        A future timestamp is never "fresh" — see below.
 *   - 'stale'            a valid, non-future timestamp older than 24h.
 *   - 'failed'           schema-current, fresh, trustworthy timestamp, but
 *                        report.passed !== true. Categorically different
 *                        from the four cases above: the report itself is
 *                        real and current, so it is still returned (not
 *                        nulled out) for scorers to read — only `hasEvidence`
 *                        is withheld. Dropping the report here would let a
 *                        real, observed failure (e.g. a failing test run)
 *                        disappear into "no evidence", inverting this
 *                        project's "absent evidence != negative evidence"
 *                        contract into its own violation.
 *
 * Future timestamps (clock skew, or a hand-edited/forged file) are
 * deliberately rejected rather than treated as fresh: `now - at` is negative
 * for a future `at`, so a staleness check alone (`> MAX_AGE_MS`) would never
 * catch it — the report would look perpetually fresh. There is no grace
 * window for small skew; any `at > now` is untrustworthy by definition,
 * and this tool would rather report "no evidence" than accept a timestamp
 * that claims to be from the future.
 */
function loadEvidence(ctx, now) {
  const raw = ctx.readJson('.harness/verify-report.json');
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { report: null, verifiedAt: null, reason: 'missing' };
  }
  if (raw.schemaVersion !== 1) {
    return { report: null, verifiedAt: null, reason: 'schemaMismatch' };
  }
  const at = new Date(raw.generatedAt);
  if (Number.isNaN(at.getTime()) || at > now) {
    return { report: null, verifiedAt: null, reason: 'invalidTimestamp' };
  }
  if (now - at > EVIDENCE_MAX_AGE_MS) {
    return { report: null, verifiedAt: null, reason: 'stale' };
  }
  if (raw.passed !== true) {
    return { report: raw, verifiedAt: at, reason: 'failed' };
  }
  return { report: raw, verifiedAt: at, reason: null };
}

/**
 * Pure orchestration: every input (including `now`) is caller-supplied, so
 * the same inputs always produce the same report (see report.mjs's own
 * determinism contract, which this function must not violate).
 *
 * Two ScanContexts, deliberately not merged into one: `createScanContext`
 * never reads config on its own, so `ignore` only takes effect when passed
 * explicitly as `opts.ignore`. The first context exists solely to load
 * `harness.config.json` (or fall back to AGENTS.md/CLAUDE.md) and read
 * `config.ignore` off of it; the second, built from that `ignore` list, is
 * the one actually handed to stack detection and every scorer. Collapsing
 * these into a single call would silently disable `ignore` for the whole
 * run — concretely, this repository's own self-assessment (Task 24) would
 * pick up the go.mod files nested under fixtures/ and misdetect itself as a
 * Go project.
 */
export function runAssess({ repoPath, lang, configPath, profile = DEFAULT_PROFILE, now }) {
  const canonicalProfile = assertProfile(profile);
  const ctx = createScanContext(repoPath);
  const config = loadConfig(ctx, { configPath });
  const scanCtx = createScanContext(repoPath, { ignore: config.ignore });
  const stack = detectStack(scanCtx);
  const { report: verifyReport, verifiedAt, reason: evidenceReason } = loadEvidence(scanCtx, now);
  const baseResults = {};
  for (const s of SCORERS) {
    baseResults[s.id] = s.score({ ctx: scanCtx, stack, config, verifyReport, now });
  }
  const results = applyDiagnosticOverlay(
    baseResults,
    profileOverlay({ profile: canonicalProfile, ctx: scanCtx, config }),
  );
  return buildReport({
    repo: repoPath, stack, results,
    // A single source of truth: `evidenceReason` is null exactly when
    // loadEvidence considers the report valid evidence, so `hasEvidence`
    // is derived from it directly rather than re-deriving an equivalent
    // condition from `verifyReport` a second time — two expressions that
    // are supposed to always agree is exactly the kind of drift this
    // codebase has already been bitten by (see feedback.mjs's own notes on
    // PRUNE_DIRS/DEFAULT_IGNORE and docker.runtimePins/manifest).
    hasEvidence: evidenceReason === null,
    evidenceReason,
    verifiedAt, toolVersion: toolVersion(), now, lang, profile: canonicalProfile,
  });
}

/** `--min-level` must be exactly one of '0'..'5' — anything else is a usage
 * error (exit 2), never a silent NaN that reads as "level not reached"
 * (exit 1). `Number('abc') >= N` is always false, so without this check a
 * typo in the flag value is indistinguishable from a repo that legitimately
 * fails the gate — the user can never tell which one happened. */
function parseMinLevel(raw) {
  if (raw === undefined) return null;
  if (!/^[0-5]$/.test(raw)) {
    throw new CliError(`Invalid --min-level '${raw}': expected an integer between 0 and 5.`);
  }
  return Number(raw);
}

function main(argv) {
  const { values, positionals } = parseCli(argv, {
    options: {
      json: { type: 'boolean', default: false },
      lang: { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string' },
      profile: { type: 'string' },
      'min-level': { type: 'string' },
    },
    allowPositional: true,
  });
  const minLevel = parseMinLevel(values['min-level']);
  const profile = assertProfile(values.profile);
  const repoPath = resolveRepoPath(positionals, process.cwd());
  const ctx = createScanContext(repoPath);
  const lang = assertLang(values.lang ?? loadConfig(ctx, { configPath: values.config }).lang);
  const report = runAssess({ repoPath, lang, configPath: values.config, profile, now: new Date() });

  const output = values.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderMarkdown(report, lang)}\n`;
  if (values.out) writeFileSync(values.out, output);
  else process.stdout.write(output);

  if (minLevel !== null) {
    return report.level.id >= minLevel ? 0 : 1;
  }
  // allGaps, not report.subsystems[].gaps: a gap suppressed for readability
  // is still a failing check, and the exit code is a behavioural contract
  // ("this repository has a high-severity gap"), not a summary of what got
  // printed. Reading the rendered subset here made a repo whose only
  // high-severity gaps were suppressed exit 0 with no scorer change --
  // README's "stable interface" that this project's own CI gates on,
  // quietly inverted.
  const hasHigh = allGaps(report).some((g) => g.severity === 'high');
  return hasHigh ? 1 : 0;
}

// Compare real filesystem paths, not raw URL strings: process.argv[1] is a
// raw, unresolved path, while import.meta.url is derived from Node's
// resolved (symlink-following) module path. A hand-built
// `file://${process.argv[1]}` template string (the plan's original code)
// breaks on a space, a non-ASCII character, or a Windows drive letter,
// because those need percent-encoding that the template string never
// applies. Swapping in `pathToFileURL(process.argv[1]).href` alone (the
// brief's suggested fix) still isn't enough on its own: it round-trips
// spaces and unicode correctly, but on macOS `/tmp` is itself a symlink to
// `/private/tmp`, and Node resolves import.meta.url through that symlink
// while process.argv[1] keeps whatever path was typed on the command
// line — so a script invoked from anywhere under a symlinked directory
// would still fail this check with pathToFileURL alone. realpathSync()
// resolves symlinks on the argv side to match, and fileURLToPath() decodes
// the URL back to a plain fs path on the other side, so both sides are
// finally directly comparable. Get this wrong and the symptom is silent:
// the script "runs" (exit 0) and prints nothing, because main() was never
// called — this is a CLI meant for other people's repositories, whose paths
// (and whether they sit under a symlink) this tool does not control.
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(err.exitCode);
    }
    // Deliberately a different code from both CliError (2, "you mistyped
    // something") and a gate failure (1, "the repo scored below the bar" —
    // an expected, meaningful outcome of a successful run). Reusing either
    // would make it impossible to tell "the tool itself broke" apart from
    // one of those two, which is exactly the ambiguity this fix exists to
    // remove. 3 is otherwise unused by this script.
    process.stderr.write(`${err.stack ?? err.message}\n`);
    process.exit(3);
  }
}
