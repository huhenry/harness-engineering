#!/usr/bin/env node
import { writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCli, CliError } from './lib/cli.mjs';
import { t, assertLang } from './lib/i18n.mjs';
import { gapById } from './lib/rubric.mjs';
import { computeDiff } from './lib/diff.mjs';

/** Read and JSON.parse a report file, converting either failure into a
 * usage error (exit 2) that names the offending path -- a caller handing
 * this tool a missing file or a broken JSON document made a mistake, the
 * tool did not. */
function loadReport(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new CliError(`Could not read ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CliError(`Could not parse ${path} as JSON: ${err.message}`);
  }
}

/** Format a delta with an explicit sign: `+4`, `-2`, or `0`. Bare numbers
 * read as ambiguous in a before/after context -- `4` could be a delta or a
 * raw score -- so every delta this script prints carries its own sign.
 *
 * Exported for scripts/action.mjs, whose verdict line quotes the same delta
 * this script's markdown already prints. Two independent implementations of
 * "how a delta is spelled" is precisely the hand-synced duplication this
 * project keeps having to fix (see the lint command, MAX_SCORE, and
 * PRUNE_DIRS/DEFAULT_IGNORE) -- one of them formats `0` as `+0` a year from
 * now and nothing catches it. */
export function fmtDelta(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

/** One `- title (severity)` line for a fixed/introduced gap. Looks the
 * title up from the rubric via the gap's id, never from either report's own
 * (already-translated, and therefore language-specific) `gap.title` --
 * see computeDiff's own determinism contract: an id is the only thing
 * guaranteed to mean the same thing on both sides of a diff. */
function renderGapLine(gap, lang) {
  const title = t(gapById(gap.id).titleKey, lang);
  const severity = t(`severity.${gap.severity}`, lang);
  return `- ${title} (${severity})`;
}

/**
 * Render a `DiffResult` (see `computeDiff`) as markdown.
 *
 * Mirrors report.mjs's renderMarkdown in spirit: `lang` only selects the
 * template strings (headings, labels) that wrap the content -- subsystem
 * ids and gap ids come from the rubric via `t()`, never from prose either
 * report happened to carry. Empty `fixed`/`introduced` sections render no
 * heading and no blank line for themselves (v1.1 shipped a stray blank line
 * from an analogous renderer and a reviewer caught it) -- when both are
 * empty, a single explicit "no gap changes" line takes their place instead
 * of the document just trailing off after the subsystem table.
 *
 * Exported so scripts/action.mjs can put THIS body -- not a second,
 * separately maintained rendering of the same DiffResult -- into its pull
 * request comment. The Action wraps a marker line, a verdict sentence and a
 * footer around it and changes nothing inside, so what a reviewer reads on
 * a pull request is byte-for-byte what `diff.mjs` prints locally. Importing
 * this module is side-effect-free: the `isMainModule()` guard at the bottom
 * compares resolved paths, so nothing runs when it is imported rather than
 * executed.
 */
export function renderDiffMarkdown(result, lang) {
  const lines = [];
  lines.push(`# ${t('diff.title', lang)}`, '');
  lines.push(t('diff.score', lang, {
    before: result.before.total, after: result.after.total, delta: fmtDelta(result.delta.total),
  }), '');
  lines.push(t('diff.level', lang, {
    before: result.before.level, after: result.after.level, delta: fmtDelta(result.delta.level),
  }), '');
  if (result.regression) {
    lines.push(t('diff.regression', lang, { reasons: result.regressionReasons.join(', ') }), '');
  }

  lines.push(`## ${t('diff.subsystemsHeading', lang)}`, '');
  lines.push(`| ${t('diff.colSubsystem', lang)} | ${t('diff.colScore', lang)} | ${t('diff.colDelta', lang)} |`);
  lines.push('| --- | --- | --- |');
  for (const s of result.subsystems) {
    const name = t(`subsystem.${s.id}`, lang);
    lines.push(`| ${name} | ${s.before} → ${s.after} | ${fmtDelta(s.delta)} |`);
  }
  lines.push('');

  const { fixed, introduced } = result.gaps;
  if (fixed.length > 0) {
    lines.push(`## ${t('diff.fixedHeading', lang)}`, '');
    for (const g of fixed) lines.push(renderGapLine(g, lang));
    lines.push('');
  }
  if (introduced.length > 0) {
    lines.push(`## ${t('diff.introducedHeading', lang)}`, '');
    for (const g of introduced) lines.push(renderGapLine(g, lang));
    lines.push('');
  }
  if (fixed.length === 0 && introduced.length === 0) {
    lines.push(t('diff.noGapChanges', lang), '');
  }

  return lines.join('\n');
}

function main(argv) {
  const { values, positionals } = parseCli(argv, {
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      lang: { type: 'string' },
    },
    allowPositional: true,
  });

  if (positionals.length !== 2) {
    throw new CliError(
      `diff requires exactly two positional arguments: <before.json> <after.json> (got ${positionals.length})`,
    );
  }
  const [beforePath, afterPath] = positionals;
  const lang = assertLang(values.lang ?? 'en');

  const before = loadReport(beforePath);
  const after = loadReport(afterPath);

  // computeDiff itself never looks at schemaVersion -- it is purely a
  // reports-in-memory comparison, and two reports built under different
  // schema versions could carry fields that mean different things under
  // the same key. Comparing them anyway would produce numbers that look
  // plausible and mean nothing; this project would rather refuse than
  // answer with a number nobody can trust.
  if (before?.schemaVersion !== 1 || after?.schemaVersion !== 1 || before.schemaVersion !== after.schemaVersion) {
    throw new CliError(
      `schemaVersion mismatch: before=${before?.schemaVersion} after=${after?.schemaVersion} `
      + '(diff requires both reports to have schemaVersion === 1)',
    );
  }

  let result;
  try {
    result = computeDiff(before, after);
  } catch (err) {
    // computeDiff is a pure library function and throws a plain TypeError
    // (never CliError -- it has no business importing a CLI concept) when a
    // report is missing or has a non-finite score.total/score.max/level.id
    // or subsystem score. That is a malformed INPUT FILE, not this tool
    // breaking -- "you gave me a bad file" is a usage error (exit 2), the
    // same bucket as a missing file or unparseable JSON above, not the
    // generic top-level handler's "the tool itself broke" (exit 3). The
    // TypeError's own message already names the exact field and side that
    // failed, so it is reused verbatim rather than replaced with something
    // vaguer.
    if (err instanceof TypeError) throw new CliError(err.message);
    throw err;
  }

  const output = values.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderDiffMarkdown(result, lang)}\n`;
  if (values.out) writeFileSync(values.out, output);
  else process.stdout.write(output);

  // The property that lets a team gate CI on this: a regression (score,
  // level, or any gated subsystem moving backwards) is a meaningful,
  // successful comparison result, not a tool failure -- so it gets its own
  // exit code (1) distinct from both "you used it wrong" (2) and "the tool
  // broke" (3), exactly like assess's `--min-level` gate.
  return result.regression ? 1 : 0;
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
    // Deliberately a different code from both CliError (2, "you gave me a
    // bad flag or a bad file") and a real regression (1, "the after report
    // legitimately scored worse than the before report" — an expected,
    // meaningful outcome of a successful comparison, not a crash). Reusing
    // either would make it impossible to tell "the tool itself broke" apart
    // from one of those two, which is exactly the ambiguity assess.mjs's
    // own top-level handler was written to preserve. 3 is otherwise unused
    // by this script.
    process.stderr.write(`${err.stack ?? err.message}\n`);
    process.exit(3);
  }
}
