import { SUBSYSTEMS } from './rubric.mjs';
import { allGaps } from './report.mjs';

export const DIFF_SCHEMA_VERSION = 1;

/**
 * Every gap in a report, keyed by id — INCLUDING suppressed ones.
 *
 * `allGaps`, never `visibleGaps`. A suppressed gap is still a failing check;
 * only the markdown hides it. Diffing the visible list would report a gap
 * that merely became suppressed as "fixed", telling a user they repaired
 * something they never touched — the report stating something untrue, which
 * is the single thing this project exists to prevent. Same reasoning as
 * assess.mjs's exit-code decision, which reads allGaps for the same reason.
 */
function gapsById(report) {
  return new Map(allGaps(report).map((g) => [g.id, g]));
}

/**
 * Subsystem scores keyed by id.
 *
 * Trusts `validateReport` has already run: every id in SUBSYSTEMS is present
 * with a finite score. This function used to fall back to `?? 0` for a
 * missing subsystem, which meant a malformed report silently read as "this
 * subsystem scored zero" — a large, fabricated drop that would fire a false
 * subsystem regression instead of surfacing the actual problem, which is
 * that the input was not a real report. `validateReport` turns that into a
 * thrown error before any arithmetic happens, so there is nothing left here
 * to default.
 */
function scoresById(report) {
  return new Map(report.subsystems.map((s) => [s.id, s.score]));
}

/**
 * Reject a report `computeDiff` cannot trust, naming the exact field and
 * side (before/after) that failed, instead of letting it flow into
 * arithmetic and surface later as a silent `NaN`.
 *
 * `NaN < 0` is `false`, so an unguarded `deltaTotal`/`deltaLevel` computed
 * from a report missing `score.total` or `level.id` would make the
 * corresponding regression clause never fire — no crash, no signal, just a
 * caller who believes the check ran and it didn't. Same principle
 * assess.mjs's `loadEvidence` applies to a future timestamp: refuse a value
 * that only looks trustworthy rather than accept it and report something
 * false. `computeDiff` is a pure library function, not a CLI entry point, so
 * it throws a plain `TypeError` rather than `cli.mjs`'s `CliError` — that
 * class exists to carry an `exitCode` a CLI wrapper reads, which is a
 * concern this module has no business importing. Task 2's CLI is expected
 * to catch this and turn it into its own exit code, the same way it already
 * plans to for a `schemaVersion` mismatch.
 */
function validateReport(report, side) {
  const num = (value) => typeof value === 'number' && Number.isFinite(value);
  if (!num(report?.score?.total)) {
    throw new TypeError(`computeDiff: ${side}.score.total must be a finite number, got ${report?.score?.total}`);
  }
  if (!num(report?.score?.max)) {
    throw new TypeError(`computeDiff: ${side}.score.max must be a finite number, got ${report?.score?.max}`);
  }
  if (!num(report?.level?.id)) {
    throw new TypeError(`computeDiff: ${side}.level.id must be a finite number, got ${report?.level?.id}`);
  }
  if (!Array.isArray(report?.subsystems)) {
    throw new TypeError(`computeDiff: ${side}.subsystems must be an array, got ${report?.subsystems}`);
  }
  const scores = new Map(report.subsystems.map((s) => [s.id, s.score]));
  for (const id of SUBSYSTEMS) {
    if (!num(scores.get(id))) {
      throw new TypeError(`computeDiff: ${side}.subsystems is missing a finite score for '${id}'`);
    }
  }
}

/**
 * Compare two `assess --json` reports.
 *
 * Pure: no I/O, no clock, no ambient state — the same pair of reports always
 * produces a byte-identical result. Throws (does not return a sentinel) on a
 * malformed `before`/`after` — see `validateReport`.
 *
 * Everything is compared by ID, never by rendered text. `gap.title`/`why`/
 * `fix` and `level.name` are already-translated strings materialized by
 * buildReport in its own `lang` (see report.mjs's determinism contract), so
 * an `en` report and a `zh` report of the same repository differ in every
 * one of them while describing identical facts.
 */
export function computeDiff(before, after) {
  validateReport(before, 'before');
  validateReport(after, 'after');

  const beforeScores = scoresById(before);
  const afterScores = scoresById(after);

  const subsystems = SUBSYSTEMS.map((id) => {
    const b = beforeScores.get(id);
    const a = afterScores.get(id);
    return { id, before: b, after: a, delta: a - b };
  });

  const deltaTotal = after.score.total - before.score.total;
  const deltaLevel = after.level.id - before.level.id;

  // The regression contract, in one place because it is a public interface
  // (the CLI's exit code and the Action's fail-on-regression input both read
  // it). Clause 3 is not redundant with clause 1: a total can hold steady
  // while a gated subsystem falls (tools +1, state -1), and levels are gated
  // rather than derived from the total, so state 3 -> 2 drops L3 with no
  // change in the number a total-only check would look at.
  //
  // Gap COUNT deliberately does not appear here. A tool upgrade that ships a
  // new gap id raises every repository's gap count without any repository
  // having changed; counting that as a regression would make upgrading the
  // tool indistinguishable from breaking the repo.
  const regressionReasons = [];
  if (deltaTotal < 0) regressionReasons.push('total');
  if (deltaLevel < 0) regressionReasons.push('level');
  for (const s of subsystems) {
    if (s.delta < 0) regressionReasons.push(`subsystem:${s.id}`);
  }

  const beforeGaps = gapsById(before);
  const afterGaps = gapsById(after);
  const fixed = [];
  const introduced = [];
  for (const [id, g] of beforeGaps) {
    if (!afterGaps.has(id)) fixed.push({ id, severity: g.severity });
  }
  for (const [id, g] of afterGaps) {
    if (!beforeGaps.has(id)) introduced.push({ id, severity: g.severity });
  }

  return {
    schemaVersion: DIFF_SCHEMA_VERSION,
    before: { total: before.score.total, max: before.score.max, level: before.level.id },
    after: { total: after.score.total, max: after.score.max, level: after.level.id },
    delta: { total: deltaTotal, level: deltaLevel },
    regression: regressionReasons.length > 0,
    regressionReasons,
    subsystems,
    gaps: { fixed, introduced },
  };
}
