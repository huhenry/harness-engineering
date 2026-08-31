import { SUBSYSTEMS, MAX_SCORE, gapById } from './rubric.mjs';
import { computeRoi, sortGaps } from './roi.mjs';
import { computeLevel } from './level.mjs';
import { t } from './i18n.mjs';

export const SCHEMA_VERSION = 1;

/**
 * Translate one gap message and prove nothing was left unsubstituted.
 *
 * A gap's `why`/`fix` may name the specific artefact that caused it (see
 * state.mjs's `gapVars`). `t()` deliberately leaves an unknown `{name}`
 * alone rather than throwing, which is right for its own contract but wrong
 * here: a scorer that emits a gap and forgets its vars would ship the
 * literal text "{artefacts}" to the user, silently. Materialization is the
 * one place that can see the finished string, so it is the place to refuse.
 * Same reasoning as `t()` throwing on a missing key rather than rendering
 * the key itself.
 */
function materialize(key, lang, vars) {
  const text = t(key, lang, vars);
  const leftover = text.match(/\{(\w+)\}/);
  if (leftover) {
    throw new Error(`Unsubstituted placeholder {${leftover[1]}} in ${key} — the scorer must supply it via gapVars`);
  }
  return text;
}

/**
 * Assemble the machine-readable report (spec 6.3's `harness-report.json`).
 * Pure: every input, including `lang`, is injected by the caller — no
 * Date.now()/Math.random(), no reading of ambient state.
 *
 * `lang` is a `buildReport` input, not just `renderMarkdown`'s. Task-14's
 * controller ruling settled a conflict between spec 6.3 (which shows
 * `level.name` as an already-translated string, e.g. "Continuous") and the
 * plan's draft code (which stored the i18n key, e.g. "level.3"): the
 * translated string wins, for the same reason the plan already requires
 * `gap.title`/`why`/`fix` to be materialized rather than left as keys — a
 * JSON consumer of this report should never have to hold its own copy of
 * the i18n table. That means the exact same repo scored twice, once with
 * `lang: 'en'` and once with `lang: 'zh'`, legitimately produces two
 * different (but each internally consistent) JSON documents. The
 * determinism contract this module must uphold is narrower: same `lang` +
 * same inputs => byte-identical JSON, every time.
 */
export function buildReport({
  repo, stack, results, hasEvidence, evidenceReason = null, verifiedAt, toolVersion, now, lang,
}) {
  const scores = Object.fromEntries(SUBSYSTEMS.map((id) => [id, results[id].score]));

  const subsystems = SUBSYSTEMS.map((id) => {
    const r = results[id];
    // A gap whose precondition gap is also present in this same subsystem is
    // MARKED, never dropped — reporting "Progress file is stale" alongside
    // "No progress file" tells the user about a file the report just said
    // does not exist, so the human report hides it, but it is still a
    // failing check and everything that acts on facts must still see it.
    //
    // Marking rather than filtering is the whole design. The first version
    // filtered here, and two consumers downstream read the filtered list
    // without anyone noticing: `assess`'s exit code (a repo with a
    // suppressed high-severity gap silently started exiting 0) and
    // `scaffold`'s plan. Both were reading `subsystems[].gaps` because that
    // is the obvious thing to read. Now the obvious thing to read is
    // complete, and hiding is an explicit opt-in that only renderMarkdown
    // takes — so the failure mode inverts: forgetting about suppression
    // over-reports rather than under-reports.
    const present = new Set(r.gapIds);
    const gaps = sortGaps(r.gapIds.map((gapId) => {
      const def = gapById(gapId);
      const vars = r.gapVars?.[gapId] ?? {};
      const pre = def.presupposedBy;
      return {
        id: def.id,
        severity: def.severity,
        title: materialize(def.titleKey, lang, vars),
        why: materialize(def.whyKey, lang, vars),
        fix: materialize(def.fixKey, lang, vars),
        scaffoldable: def.scaffoldable,
        roi: computeRoi(def, r.score),
        // The gap id that makes this one not worth showing a human, or
        // null. Never affects the score, and never affects anything that
        // decides what to do — only what gets printed.
        suppressedBy: pre !== null && present.has(pre) ? pre : null,
      };
    }));
    return {
      id,
      score: r.score,
      max: MAX_SCORE,
      cappedByEvidence: r.cappedByEvidence,
      evidence: r.evidence,
      gaps,
    };
  });

  const total = SUBSYSTEMS.reduce((sum, id) => sum + scores[id], 0);
  const level = computeLevel(scores, hasEvidence);

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: 'harness-engineering', version: toolVersion },
    repo,
    generatedAt: now.toISOString(),
    stack,
    score: { total, max: SUBSYSTEMS.length * MAX_SCORE },
    // unmetGates is a spec 6.3 superset, not a conflict with it: Task 15's
    // `assess --min-level` needs to say what's blocking the next gate, and
    // computeLevel already produces exactly that list — carrying it through
    // here means it doesn't need recomputing downstream.
    level: { id: level.id, name: t(level.nameKey, lang), unmetGates: level.unmetGates },
    // `reason` is a stable, machine-readable identifier for *why* evidence
    // isn't in effect (task-15 brief section B) — null exactly when
    // `hasEvidence` is true. Left as an opaque string rather than
    // pre-translated text so a JSON consumer can branch on it without
    // string-matching localized prose; renderMarkdown looks up its
    // translation via `evidence.reason.<id>` at render time instead.
    evidence: {
      verified: hasEvidence,
      verifiedAt: verifiedAt ? verifiedAt.toISOString() : null,
      reason: evidenceReason,
    },
    subsystems,
  };
}

/**
 * Every gap the scorers found, flattened across subsystems and sorted once
 * globally by ROI, each tagged with the subsystem it came from.
 *
 * This is what anything DECIDING something must call — `assess`'s exit code,
 * `scaffold`'s plan — because suppression is a presentation choice and a
 * suppressed gap is still a failing check. Reading `report.subsystems`
 * directly is not wrong, it is just easy to get wrong; routing both
 * behavioural consumers through one named function is what
 * tests/report.test.mjs can then pin.
 */
export function allGaps(report) {
  return sortGaps(report.subsystems.flatMap((s) => s.gaps.map((gap) => ({ ...gap, subsystemId: s.id }))));
}

/**
 * The subset a human report shows: everything except gaps whose precondition
 * is in the same report. Presentation only — see `allGaps` above for the
 * list anything behavioural must use instead.
 */
export function visibleGaps(report) {
  return allGaps(report).filter((gap) => gap.suppressedBy === null);
}

/** One markdown table row per subsystem: name, score/max, evidence-cap marker. */
function renderSubsystemTable(report, lang) {
  const lines = [
    `## ${t('report.subsystemsHeading', lang)}`,
    '',
    `| ${t('report.colSubsystem', lang)} | ${t('report.colScore', lang)} | ${t('report.colStatus', lang)} |`,
    '| --- | --- | --- |',
  ];
  for (const s of report.subsystems) {
    const name = t(`subsystem.${s.id}`, lang);
    const status = s.cappedByEvidence ? t('report.needsEvidence', lang) : '';
    lines.push(`| ${name} | ${s.score}/${s.max} | ${status} |`);
  }
  lines.push('');
  return lines;
}

/**
 * Global gap list, ROI descending, across every subsystem — not grouped
 * per subsystem. Grouping by subsystem first would make each subsystem's
 * own slice locally sorted but the document as a whole non-monotonic in
 * ROI, since one subsystem's low-ROI gap would land ahead of the next
 * subsystem's high-ROI gap. Flatten first, then sort once, globally.
 */
/**
 * One line naming the high-severity gaps this report is hiding, or nothing
 * at all.
 *
 * Suppression has no severity dimension — a `low` precondition can silence a
 * `high` gap, and `loop.none` (low) silencing `loop.no-stop-condition` and
 * `loop.no-budget-cap` (both high) is a live, ordinary case. That produced a
 * report with no high-severity findings printed beside an exit code of 1,
 * which README defines as "high-severity gaps found". The exit code is
 * right; what was missing was the report admitting it had left something
 * out.
 *
 * Returns [] — not an empty string — when there is nothing to say, so a
 * report without suppressed high-severity gaps is byte-identical to what it
 * was before this existed. Suppressed gaps below `high` stay silent
 * deliberately: they are the noise this mechanism was built to remove.
 */
function suppressedHighNote(report, lang) {
  const hidden = allGaps(report).filter((g) => g.suppressedBy !== null && g.severity === 'high');
  if (hidden.length === 0) return [];
  const titleOf = new Map(allGaps(report).map((g) => [g.id, g.title]));
  // Several different preconditions can be hiding high-severity gaps in one
  // report (loop.none and feedback.no-declared-commands routinely do), so
  // every distinct one is named. Deduped in ROI order, so the sentence is
  // deterministic and leads with the one worth fixing first.
  const implied = [...new Set(hidden.map((g) => g.suppressedBy))].map((id) => titleOf.get(id) ?? id);
  return [t('report.suppressedHigh', lang, { count: hidden.length, titles: implied.join(', ') }), ''];
}

function renderGapList(report, lang) {
  const lines = [`## ${t('report.gapsHeading', lang)}`, ''];
  // The one place suppression is allowed to take effect.
  const shown = visibleGaps(report);
  if (shown.length === 0) {
    // Unreachable with a non-empty hidden set: a precondition gap is never
    // suppressed by itself, so anything hidden implies something shown.
    lines.push(t('report.noGaps', lang), '');
    return lines;
  }
  lines.push(...suppressedHighNote(report, lang));
  for (const gap of shown) {
    const subsystemName = t(`subsystem.${gap.subsystemId}`, lang);
    lines.push(`### ${subsystemName} · ${gap.title} (ROI ${gap.roi})`, '');
    lines.push(`- ${t('report.why', lang, { text: gap.why })}`);
    lines.push(`- ${t('report.fix', lang, { text: gap.fix })}`, '');
  }
  return lines;
}

/**
 * Render the human-readable report. `report.level.name` and every
 * `gap.title`/`why`/`fix` are already translated (materialized by
 * `buildReport` in its own `lang`) — this function must not call `t()` on
 * them again. `lang` here only selects which template strings (headings,
 * labels, table columns) wrap that already-translated content; the caller
 * is responsible for passing the same `lang` the report was built with —
 * mixing them produces a document whose scaffolding and content disagree.
 */
export function renderMarkdown(report, lang) {
  const lines = [];
  lines.push(`# ${t('report.title', lang)}`, '');
  lines.push(t('report.score', lang, report.score), '');
  lines.push(t('report.level', lang, { id: report.level.id, name: report.level.name }), '');
  // Task-15 brief section B: when evidence didn't take effect, say why —
  // not just "unverified". `report.evidence.reason` is only ever null when
  // verified is true (see buildReport), so this guard also protects
  // callers/tests that build a report with `verified: false` but no
  // `evidenceReason` at all (the field defaults to null) from a "missing
  // i18n key" crash on a reason that was never supplied.
  if (!report.evidence.verified && report.evidence.reason) {
    const reasonText = t(`evidence.reason.${report.evidence.reason}`, lang);
    lines.push(t('report.evidenceNote', lang, { text: reasonText }), '');
  }
  lines.push(...renderSubsystemTable(report, lang));
  lines.push(...renderGapList(report, lang));
  return lines.join('\n');
}
