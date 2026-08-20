export const SUBSYSTEMS = ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop'];

/**
 * The top rung of every subsystem's ladder, and the multiplier behind the
 * total. Was eight independent literal 4s (report.mjs twice, once in each of
 * the six scorers) with no shared constant behind any of them — the same
 * class of hand-synced duplication that has bitten this codebase four times
 * already. (2 + 6 = 8. The commit that did the collapse, and four documents
 * that described it, all said "seven"; the arithmetic in the parenthetical
 * refuted it in the same sentence. Corrected everywhere except the commit
 * message, which is history.)
 */
export const MAX_SCORE = 4;

/**
 * `presupposedBy` names another gap in the SAME subsystem whose presence
 * makes this one meaningless — "Progress file is stale" presupposes a
 * progress file, which "No progress file" just said does not exist, so
 * showing both in the same report asserts a contradiction. Declared here
 * rather than hardcoded in report.mjs so a future pair is one line in this
 * table, not a new branch in the renderer.
 *
 * The bar for adding a pair is deliberately higher than "these two
 * co-occur". All four of these must hold:
 *
 *   1. Same subsystem (pinned by tests/rubric.test.mjs).
 *   2. The suppressed gap's own TEXT names an object whose existence the
 *      other gap denies — it is incoherent in that state, not merely lower
 *      priority. Two independent facts about two different artefacts are
 *      NOT a presupposition, however reliably they appear together.
 *   3. The suppressed gap writes no template the precondition gap does not
 *      already write (in practice: it is not scaffoldable at all). See the
 *      scores/scaffold note below — this is a real constraint, not a
 *      formality, and it is why loop.no-maker-checker is not wired to
 *      loop.none.
 *   4. Fixing the precondition re-surfaces the suppressed gap on the next
 *      run if it is still true, so suppression defers information rather
 *      than losing it.
 *
 * SCORES are unaffected: ladder.mjs still collects every failing check and
 * buildReport filters afterwards. But this is NOT purely a render-time
 * relationship, and it must not be described as one: scaffold.mjs calls
 * runAssess and reads `report.subsystems.flatMap((s) => s.gaps)` — the
 * POST-suppression list — so a suppressed gap is also a gap scaffold will
 * not act on. Every id suppressed today has `templates: []`, so nothing
 * scaffold writes changes; requirement 3 above is what keeps that true.
 */
const def = (id, severity, effort, templates = [], presupposedBy = null) => ({
  id,
  subsystem: id.split('.')[0],
  severity,
  effort,
  scaffoldable: templates.length > 0,
  templates,
  presupposedBy,
  titleKey: `gap.${id}.title`,
  whyKey: `gap.${id}.why`,
  fixKey: `gap.${id}.fix`,
});

export const GAPS = [
  // instructions
  def('instructions.missing', 'high', 1, ['AGENTS.md', 'CLAUDE.md']),
  def('instructions.no-stack-versions', 'high', 2),
  def('instructions.no-setup-commands', 'high', 2),
  def('instructions.no-constraints', 'medium', 2),
  def('instructions.no-verification', 'high', 2),
  def('instructions.too-long', 'medium', 2),
  def('instructions.no-layering', 'low', 2),
  def('instructions.stale-links', 'medium', 2),
  // tools
  def('tools.no-entrypoint', 'high', 3, ['Makefile']),
  // "Run every declared entrypoint command and fix whichever ones fail"
  // names commands tools.no-entrypoint just said do not exist. Reachable,
  // and not guarded by the scorer: an AGENTS.md that says "run `make test`"
  // in a repo with no Makefile fails BOTH rung 1 (no entrypoint file) and
  // rung 3's dangling-reference check at once.
  def('tools.broken-entrypoint', 'high', 2, [], 'tools.no-entrypoint'),
  def('tools.no-permissions', 'medium', 2, ['.claude/settings.json']),
  // NOT presupposedBy tools.no-permissions: documenting which tools are
  // auto-approved, which need confirmation and which are forbidden is prose
  // a repository can write with no permissions file anywhere. Two
  // independent artefacts, two independently fixable gaps — requirement 2.
  def('tools.no-least-privilege-doc', 'low', 2),
  // environment
  def('environment.no-lockfile', 'high', 2),
  def('environment.no-runtime-pin', 'high', 1),
  def('environment.no-bootstrap', 'medium', 1, ['init.sh']),
  // environment.mjs already drops this id when there is no execution
  // evidence at all, so it only survives when a verify report really did
  // record a bootstrap command running and not passing. That report can
  // outlive the declaration it came from (a deleted init.sh, a removed
  // config entry) for the 24 hours it stays fresh — and in that window
  // "fix the bootstrap that failed" points at a bootstrap the same report
  // says does not exist.
  def('environment.bootstrap-fails', 'high', 3, [], 'environment.no-bootstrap'),
  def('environment.no-container', 'low', 3, ['.devcontainer/devcontainer.json']),
  // state
  def('state.no-progress', 'high', 1, ['PROGRESS.md']),
  def('state.progress-stale', 'high', 2, [], 'state.no-progress'),
  def('state.progress-incomplete', 'medium', 2, [], 'state.no-progress'),
  def('state.no-feature-list', 'medium', 1, ['feature_list.json', 'feature_list.schema.json']),
  def('state.feature-list-invalid', 'high', 2),
  def('state.no-handoff', 'low', 1, ['session-handoff.md', 'clean-state-checklist.md']),
  // No templates: unlike state.no-handoff, scaffold cannot fix this one.
  // The file already exists -- scaffold never overwrites an existing file,
  // so re-running it would only ever produce a `.harness-proposed` sibling
  // next to a handoff doc that is still unfilled. The actual fix is for a
  // human to replace the FILL: placeholders with what really happened, not
  // to scaffold again.
  //
  // No `presupposedBy: 'state.no-handoff'` either, even though the two can
  // fire together (state.mjs's own comment above `anyHandoffAbsent`/
  // `anyHandoffUnfilled` calls this out): each of the two handoff artefacts
  // (session-handoff.md, clean-state-checklist.md) is classified absent/
  // unfilled/filled independently, and never both absent and unfilled at
  // once for the SAME artefact (classifyHandoffArtefact returns exactly one
  // state). So the only way both gap ids appear together is one artefact
  // missing and the OTHER present-but-unfilled -- two true, distinct
  // problems about two different files, not one gap presupposing what the
  // other just denied. Suppressing either here would hide a real file's
  // real problem, unlike the progress-file pair above where both gaps can
  // only ever be about the single same PROGRESS.md.
  def('state.handoff-unfilled', 'low', 1),
  def('state.lifecycle-undocumented', 'medium', 2),
  // feedback
  def('feedback.no-tests', 'high', 3),
  def('feedback.no-declared-commands', 'high', 1, ['harness.config.json']),
  // Both of these are about DECLARED commands by name — "run every declared
  // command at least once", "get the declared commands green first". Beside
  // "No declared verification commands" they instruct the user to act on a
  // list the same report says is empty. This is the pair visible in this
  // project's own fixtures/bad-repo, verbatim the shape the progress pair
  // above was wired for.
  def('feedback.commands-unverified', 'high', 3, [], 'feedback.no-declared-commands'),
  def('feedback.commands-failing', 'high', 3, [], 'feedback.no-declared-commands'),
  // NOT presupposedBy feedback.no-tests. "Only one kind of check exists" is
  // about the SECOND check kind (lint, typecheck) being absent, and that is
  // a real, separately fixable gap whether or not a test suite exists —
  // adding a linter closes it on its own. Requirement 2 is not met: no
  // tests is not a fact that makes "there is no lint or typecheck" absurd,
  // only one that makes it less urgent, and ROI ordering already handles
  // urgency. Suppressing it would hide a gap nothing else reports.
  def('feedback.single-check-kind', 'medium', 3),
  def('feedback.no-ci', 'medium', 3),
  def('feedback.no-e2e', 'medium', 3),
  def('feedback.no-observability', 'low', 2),
  // loop
  def('loop.none', 'low', 1, ['loop/goal-loop.md', 'loop/timer-loop.md', 'loop/maker-checker-loop.md']),
  // Every one of these describes a property OF the loop — its stop
  // condition, its budget, its rollback path. "No agentic loop defined"
  // denies the loop they are properties of, and fixing loop.none brings all
  // three straight back on the next run if they are still missing.
  def('loop.no-stop-condition', 'high', 2, [], 'loop.none'),
  def('loop.no-budget-cap', 'high', 2, [], 'loop.none'),
  // Deliberately NOT wired to loop.none, unlike its three siblings above,
  // even though the same argument applies to its text. It is the only
  // rung-3+ loop gap that is scaffoldable, and its templates are not a
  // subset of loop.none's: loop.none writes the three loop/*.md files but
  // never evaluator-rubric.md. Because scaffold.mjs consumes the
  // POST-suppression gap list, suppressing this id would stop `scaffold`
  // offering evaluator-rubric.md to exactly the repositories with no loop
  // at all — the ones that need it most — and would drop a scaffolded empty
  // repository's Loop score from 4/4 to 3/4. Requirement 3, and the reason
  // it is stated as a requirement rather than left to judgment.
  def('loop.no-maker-checker', 'medium', 2, ['evaluator-rubric.md', 'loop/maker-checker-loop.md']),
  def('loop.no-rollback', 'medium', 2, [], 'loop.none'),
];

export function gapById(id) {
  const found = GAPS.find((g) => g.id === id);
  if (!found) throw new Error(`Unknown gap id: ${id}`);
  return found;
}

export function gapsFor(subsystem) {
  return GAPS.filter((g) => g.subsystem === subsystem);
}
