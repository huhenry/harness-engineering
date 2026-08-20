import { SUBSYSTEMS, gapById } from './rubric.mjs';
import { computeRoi, sortGaps } from './roi.mjs';
import { computeLevel } from './level.mjs';
import { t } from './i18n.mjs';

export const SCHEMA_VERSION = 1;

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
    // Drop any gap whose precondition gap is also present in this same
    // subsystem — reporting "Progress file is stale" alongside "No progress
    // file" tells the user about a file the report just said does not
    // exist. Filtered here at render time, not in ladder.mjs: the score is
    // a fact about which rungs failed and must not move.
    const present = new Set(r.gapIds);
    const visibleGapIds = r.gapIds.filter((gapId) => {
      const pre = gapById(gapId).presupposedBy;
      return pre === null || !present.has(pre);
    });
    const gaps = sortGaps(visibleGapIds.map((gapId) => {
      const def = gapById(gapId);
      return {
        id: def.id,
        severity: def.severity,
        title: t(def.titleKey, lang),
        why: t(def.whyKey, lang),
        fix: t(def.fixKey, lang),
        scaffoldable: def.scaffoldable,
        roi: computeRoi(def, r.score),
      };
    }));
    return {
      id,
      score: r.score,
      max: 4,
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
    score: { total, max: SUBSYSTEMS.length * 4 },
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
function renderGapList(report, lang) {
  const lines = [`## ${t('report.gapsHeading', lang)}`, ''];
  const allGaps = sortGaps(
    report.subsystems.flatMap((s) => s.gaps.map((gap) => ({ ...gap, subsystemId: s.id }))),
  );
  if (allGaps.length === 0) {
    lines.push(t('report.noGaps', lang), '');
    return lines;
  }
  for (const gap of allGaps) {
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
