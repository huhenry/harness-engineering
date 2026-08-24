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

/** Subsystem scores keyed by id, tolerant of a report missing one. */
function scoresById(report) {
  return new Map((report.subsystems ?? []).map((s) => [s.id, s.score]));
}

/**
 * Compare two `assess --json` reports.
 *
 * Pure: no I/O, no clock, no ambient state — the same pair of reports always
 * produces a byte-identical result.
 *
 * Everything is compared by ID, never by rendered text. `gap.title`/`why`/
 * `fix` and `level.name` are already-translated strings materialized by
 * buildReport in its own `lang` (see report.mjs's determinism contract), so
 * an `en` report and a `zh` report of the same repository differ in every
 * one of them while describing identical facts.
 */
export function computeDiff(before, after) {
  const beforeScores = scoresById(before);
  const afterScores = scoresById(after);

  const subsystems = SUBSYSTEMS.map((id) => {
    const b = beforeScores.get(id) ?? 0;
    const a = afterScores.get(id) ?? 0;
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
