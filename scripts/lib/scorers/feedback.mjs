import { ladder } from './ladder.mjs';
import { VERIFY_ROLES } from '../config.mjs';
import { CI_WORKFLOW_GLOBS } from './ci-workflows.mjs';

export const id = 'feedback';

// Any hit anywhere in the tree counts — this rung only asks "is there a test
// suite at all", not "is it organized a particular way".
const TEST_FILE_PATTERNS = ['**/*_test.go', '**/test_*.py', '**/*.test.*', 'tests/**', 'spec/**'];

const OTHER_CI_FILES = ['.gitlab-ci.yml', 'Jenkinsfile'];

const OBSERVABILITY_RE = /healthz|health check|日志位置|observability/i;

/**
 * Pull `verifyReport.commands` out defensively. A verifyReport is data
 * handed to us by whatever produced the JSON file on disk (Task 18's own
 * output today, but potentially hand-edited or from an older schema) — a
 * missing or non-array `commands` field must degrade to "no evidence",
 * exactly like `verifyReport` being absent altogether, rather than throwing
 * out of `.find()`. Mirrors environment.mjs's `bootstrapCommandFrom` guard.
 */
function commandsOf(verifyReport) {
  return Array.isArray(verifyReport?.commands) ? verifyReport.commands : null;
}

/** True when `config.verify[role]` is a real, non-blank declared command. */
function isDeclared(config, role) {
  const v = config?.verify?.[role];
  return typeof v === 'string' && v.trim() !== '';
}

export function score({ ctx, config, verifyReport }) {
  const hasTests = ctx.list(TEST_FILE_PATTERNS).length > 0;
  const hasDeclaredCommands = VERIFY_ROLES.some((r) => isDeclared(config, r));

  const commands = commandsOf(verifyReport);
  // "Is there any usable execution evidence at all" — one named flag,
  // deliberately at report level rather than per-role, feeding every
  // evidence-vs-declaration branch below (secondCheckKindOk, e2eOk). A
  // malformed verifyReport (no usable `commands` array) tells us nothing
  // more than an absent one does, and neither does a structurally valid but
  // *empty* one ({ commands: [] } — exactly what Task 18's verify produces
  // when nothing is declared, or when every declared command is blocked by
  // the safety list) — both fold into the same bucket. Review finding: an
  // earlier version keyed this on `commands === null` alone, so a { commands:
  // [] } report read as "verified" for these two checks while still reading
  // as "unverified" for cappedByEvidence below — the two notions of "do we
  // have evidence" disagreed, and single-check-kind/no-e2e fired even when
  // the declared roles for them were present, just never run. One flag used
  // everywhere is what stops that drift — the same class of bug that hit
  // PRUNE_DIRS/DEFAULT_IGNORE, docker.runtimePins/manifest, and
  // CONTAINER_FILES before. NOT a per-role notion on purpose: downgrading
  // secondCheckKindOk just because the report lacks a *lint* entry (while a
  // *test* entry is present) would let a repo reach rung 3 on a test run
  // alone, which breaks rung 3's own spec (test passed AND a second check
  // kind passed).
  const noEvidence = commands === null || commands.length === 0;
  const statusOf = (role) => commands?.find((c) => c && c.role === role)?.status ?? null;

  const testStatus = statusOf('test');
  // "Has evidence about the test role" is a strictly weaker claim than "the
  // test role passed" — a recorded entry exists at all, pass or fail.
  const hasTestEvidence = testStatus !== null;
  // Only a *recorded* non-passing status counts as an observed failure.
  // Without an entry (hasTestEvidence false), this stays false: we must
  // never assert "it failed" for a command nobody ran (contract: missing
  // evidence is not negative evidence).
  const testObservedFail = hasTestEvidence && testStatus !== 'passed';

  const lintOrTypecheckPassed = statusOf('lint') === 'passed' || statusOf('typecheck') === 'passed';
  const lintOrTypecheckDeclared = isDeclared(config, 'lint') || isDeclared(config, 'typecheck');
  // Rung 3's "second check kind" condition is genuinely about *evidence*
  // (lint/typecheck actually ran and passed) whenever we have a report to
  // read. But when there is no evidence at all, judging it against
  // lintOrTypecheckPassed would *always* fail — every unverified repo would
  // get flagged for this regardless of its config, which tells the user
  // nothing about their actual setup. Falling back to "did they declare a
  // second check kind" surfaces a real, visible gap (or its absence) from
  // config alone, without pretending we observed a run that never happened.
  const secondCheckKindOk = noEvidence ? lintOrTypecheckDeclared : lintOrTypecheckPassed;

  const ciFiles = ctx.list(CI_WORKFLOW_GLOBS);
  const ciFile = ciFiles[0] ?? OTHER_CI_FILES.find((f) => ctx.exists(f)) ?? null;
  const hasCi = ciFile !== null;

  const smokeDeclared = isDeclared(config, 'smoke');
  const agentsRaw = ctx.read('AGENTS.md') ?? '';
  const hasObservability = smokeDeclared || OBSERVABILITY_RE.test(agentsRaw);

  const e2eOrSmokePassed = statusOf('e2e') === 'passed' || statusOf('smoke') === 'passed';
  const e2eOrSmokeDeclared = isDeclared(config, 'e2e') || smokeDeclared;
  // Same reasoning as secondCheckKindOk above: "did e2e/smoke pass" is only
  // an answerable question once something has actually been run. Without
  // evidence, downgrading to "was an e2e or smoke command even declared"
  // keeps this gap meaningful (a repo that never mentions e2e/smoke really
  // is missing something, and that's visible without running anything)
  // instead of either lying ("it passed") or going silent (which would hide
  // a real, statically-visible gap behind the fact that nobody ran verify).
  const e2eOk = noEvidence ? e2eOrSmokeDeclared : e2eOrSmokePassed;

  const { score, gapIds: ladderGaps } = ladder([
    { score: 1, checks: [{ ok: hasTests, gapId: 'feedback.no-tests' }] },
    { score: 2, checks: [{ ok: hasDeclaredCommands, gapId: 'feedback.no-declared-commands' }] },
    { score: 3, checks: [
      { ok: hasTestEvidence, gapId: 'feedback.commands-unverified' },
      { ok: !testObservedFail, gapId: 'feedback.commands-failing' },
      { ok: secondCheckKindOk, gapId: 'feedback.single-check-kind' },
    ] },
    { score: 4, checks: [
      { ok: e2eOk, gapId: 'feedback.no-e2e' },
      { ok: hasCi, gapId: 'feedback.no-ci' },
      { ok: hasObservability, gapId: 'feedback.no-observability' },
    ] },
  ]);

  const evidence = [];
  const testFiles = ctx.list(TEST_FILE_PATTERNS);
  if (testFiles.length > 0) evidence.push({ kind: 'file', path: testFiles[0], note: `${testFiles.length} test file(s)` });
  for (const role of VERIFY_ROLES) {
    if (!isDeclared(config, role)) continue;
    const st = statusOf(role);
    evidence.push({ kind: 'command', path: config.verify[role], note: st ? `${role}: ${st}` : `${role}: not verified` });
  }
  if (hasCi) evidence.push({ kind: 'file', path: ciFile, note: 'CI configuration' });
  if (hasObservability && OBSERVABILITY_RE.test(agentsRaw)) {
    evidence.push({ kind: 'file', path: 'AGENTS.md', note: 'observability entrypoint documented' });
  }

  // This project's core claim lives here: without a verifyReport,
  // hasTestEvidence is always false, so rung 3 can never pass and score can
  // never exceed 2 — Feedback (and therefore L4, which requires Feedback
  // >= 3) is structurally unreachable on declared commands alone.
  //
  // cappedByEvidence, though, is deliberately *narrower* than "no
  // verifyReport was supplied". It is only true when the missing report is
  // actually the sole thing holding the score back — i.e. rungs 1 and 2 are
  // both already satisfied (real tests exist, real commands are declared)
  // and the only reason rung 3 fails is the absence of a report to read. A
  // repo that doesn't even have a test suite yet gets no benefit from being
  // told "go verify" — running verify would change nothing, and that dead-end
  // promise is exactly the kind of broken feedback loop this tool exists to
  // eliminate.
  //
  // Deliberately keyed on !hasTestEvidence, not on the report-level
  // `noEvidence` flag used above for secondCheckKindOk/e2eOk: cappedByEvidence
  // answers a narrower question — specifically, is missing *test*-role
  // evidence the reason rung 3's first check fails right now — so it must
  // track hasTestEvidence exactly, not a coarser "is there any evidence for
  // anything" signal. (The two happen to agree whenever commands is null or
  // empty, since hasTestEvidence is false in both those cases too; they can
  // only diverge when commands has entries for other roles but not 'test' —
  // and in that case cappedByEvidence: true is still the correct answer,
  // since re-running verify with the test role included would unlock rung 3.)
  const cappedByEvidence = hasTests && hasDeclaredCommands && !hasTestEvidence;

  return { score, cappedByEvidence, evidence, gapIds: ladderGaps };
}
