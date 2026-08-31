import { ladder } from './ladder.mjs';
import { CI_WORKFLOW_GLOBS } from './ci-workflows.mjs';
import { MAX_SCORE } from '../rubric.mjs';
import { analyzeLoopText } from '../loop-facts.mjs';

export const id = 'loop';

// Where "the docs" means for this subsystem. Deliberately wider than
// instructions.mjs (AGENTS.md/CLAUDE.md only): README.md is where projects
// most commonly describe an autonomous/scheduled loop for human readers, and
// a repo that keeps per-pattern loop docs under loop/ (goal loop, timer
// loop, maker-checker loop — see rubric.mjs's loop.none templates) should
// have every one of those files count too. All matching files are read and
// concatenated into one blob before any regex runs against it, so it doesn't
// matter which specific file a keyword lives in.
const DOC_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md'];
const LOOP_DOCS_GLOB = 'loop/*.md';

/** Concatenated text of every doc source this subsystem reads (see DOC_FILES above). */
function allDocsText(ctx) {
  const parts = [];
  for (const f of DOC_FILES) {
    const raw = ctx.read(f);
    if (raw !== null) parts.push(raw);
  }
  for (const f of ctx.list([LOOP_DOCS_GLOB])) {
    const raw = ctx.read(f);
    if (raw !== null) parts.push(raw);
  }
  return parts.join('\n');
}

export function score({ ctx, config }) {
  const docs = allDocsText(ctx);
  const facts = analyzeLoopText(docs);
  const hasKeyword = facts.hasKeyword;

  // Same CI_WORKFLOW_GLOBS as feedback.mjs's no-ci check (see ci-workflows.mjs)
  // — GitHub Actions accepts both .yml and .yaml, and a repo whose only
  // scheduled workflow happens to use the less-common extension must not be
  // told it has no loop entry point.
  const scheduledWorkflowFile = ctx.list(CI_WORKFLOW_GLOBS).find((f) => /schedule:/.test(ctx.read(f) ?? '')) ?? null;
  const scheduledWorkflow = scheduledWorkflowFile !== null;
  const hasLoopDir = ctx.list([LOOP_DOCS_GLOB]).length > 0;
  const configDeclaresLoop = Boolean(config?.loop);
  const hasEntryPoint = scheduledWorkflow || hasLoopDir || configDeclaresLoop;

  const hasStopCondition = facts.hasStopCondition;
  const hasBudgetCap = facts.hasBudgetCap;

  const hasMakerChecker = ctx.exists('evaluator-rubric.md') || facts.hasMakerChecker;
  const hasRollback = facts.hasRollback;

  const { score, gapIds } = ladder([
    // Rungs 1 and 2 used to share 'loop.none' on the theory that they were
    // two halves of one fact. They are not, and the difference is
    // load-bearing: rung 1 asks whether a loop pattern is described at all,
    // rung 2 whether anything actually invokes the one that is. A repo that
    // documents an autonomous nightly loop but never wires it up fails only
    // rung 2 — and it is precisely the repo that most needs to hear that its
    // loop has no stop condition and no budget cap. While both rungs emitted
    // the same id, `presupposedBy: 'loop.none'` could not tell the two
    // states apart and silenced those high-severity gaps for that repo too.
    // Separate ids; rubric.mjs suppresses loop.no-entrypoint (and the
    // rung-3+ properties) beneath loop.none, which restores the old
    // single-id output for a repo that fails both.
    { score: 1, checks: [{ ok: hasKeyword, gapId: 'loop.none' }] },
    { score: 2, checks: [{ ok: hasEntryPoint, gapId: 'loop.no-entrypoint' }] },
    { score: 3, checks: [
      { ok: hasStopCondition, gapId: 'loop.no-stop-condition' },
      { ok: hasBudgetCap, gapId: 'loop.no-budget-cap' },
    ] },
    { score: MAX_SCORE, checks: [
      { ok: hasMakerChecker, gapId: 'loop.no-maker-checker' },
      { ok: hasRollback, gapId: 'loop.no-rollback' },
    ] },
  ]);

  const evidence = [];
  const keywordFile = DOC_FILES.find((f) => analyzeLoopText(ctx.read(f) ?? '').hasKeyword);
  if (keywordFile) evidence.push({ kind: 'file', path: keywordFile, note: 'loop pattern described' });
  else if (hasKeyword) evidence.push({ kind: 'file', path: 'loop/', note: 'loop pattern described' });
  if (scheduledWorkflow) evidence.push({ kind: 'file', path: scheduledWorkflowFile, note: 'scheduled workflow' });
  if (hasLoopDir) evidence.push({ kind: 'file', path: ctx.list([LOOP_DOCS_GLOB])[0], note: 'loop doc' });
  if (configDeclaresLoop) evidence.push({ kind: 'file', path: 'harness.config.json', note: 'loop field declared' });
  if (ctx.exists('evaluator-rubric.md')) evidence.push({ kind: 'file', path: 'evaluator-rubric.md', note: 'maker-checker rubric' });

  // Every condition here is a fact about documentation and configuration —
  // whether a loop pattern is described, wired up, bounded and reversible.
  // None of it is a claim about a command having been run and observed to
  // pass or fail (spec 5.6 does not ask Loop to consume verifyReport at
  // all), so — unlike Feedback — there is no evidence-gated rung here and
  // cappedByEvidence is always false.
  return { score, cappedByEvidence: false, evidence, gapIds };
}
