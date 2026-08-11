import { ladder } from './ladder.mjs';

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

const LOOP_KEYWORD_RE = /autonomous|loop|cron|scheduled|自主|循环/i;
const STOP_CONDITION_RE = /stop condition|exit criteria|停止条件|退出条件/i;
const BUDGET_CAP_RE = /max iterations|budget|token cap|最大迭代|预算/i;
const MAKER_CHECKER_RE = /maker-checker|reviewer agent|角色分离/i;
const ROLLBACK_RE = /rollback|revert|回滚/i;

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
  const hasKeyword = LOOP_KEYWORD_RE.test(docs);

  const scheduledWorkflow = ctx.list(['.github/workflows/*.yml'])
    .some((f) => /schedule:/.test(ctx.read(f) ?? ''));
  const hasLoopDir = ctx.list([LOOP_DOCS_GLOB]).length > 0;
  const configDeclaresLoop = Boolean(config?.loop);
  const hasEntryPoint = scheduledWorkflow || hasLoopDir || configDeclaresLoop;

  const hasStopCondition = STOP_CONDITION_RE.test(docs);
  const hasBudgetCap = BUDGET_CAP_RE.test(docs);

  const hasMakerChecker = ctx.exists('evaluator-rubric.md') || MAKER_CHECKER_RE.test(docs);
  const hasRollback = ROLLBACK_RE.test(docs);

  const { score, gapIds } = ladder([
    // Rungs 1 and 2 intentionally share 'loop.none' (see rubric.mjs and
    // Task 12's brief): they're two halves of the same underlying fact ("is
    // there a loop pattern here at all — described, and actually wired
    // up"), not two independent gaps a user would fix separately.
    // ladder() already dedupes by gapId, so a repo failing both rungs still
    // only sees this id once in gapIds.
    { score: 1, checks: [{ ok: hasKeyword, gapId: 'loop.none' }] },
    { score: 2, checks: [{ ok: hasEntryPoint, gapId: 'loop.none' }] },
    { score: 3, checks: [
      { ok: hasStopCondition, gapId: 'loop.no-stop-condition' },
      { ok: hasBudgetCap, gapId: 'loop.no-budget-cap' },
    ] },
    { score: 4, checks: [
      { ok: hasMakerChecker, gapId: 'loop.no-maker-checker' },
      { ok: hasRollback, gapId: 'loop.no-rollback' },
    ] },
  ]);

  const evidence = [];
  const keywordFile = DOC_FILES.find((f) => LOOP_KEYWORD_RE.test(ctx.read(f) ?? ''));
  if (keywordFile) evidence.push({ kind: 'file', path: keywordFile, note: 'loop pattern described' });
  else if (hasKeyword) evidence.push({ kind: 'file', path: 'loop/', note: 'loop pattern described' });
  if (scheduledWorkflow) {
    const wf = ctx.list(['.github/workflows/*.yml']).find((f) => /schedule:/.test(ctx.read(f) ?? ''));
    evidence.push({ kind: 'file', path: wf, note: 'scheduled workflow' });
  }
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
