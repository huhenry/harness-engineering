/**
 * Canonical verify command statuses, shared between `verify.mjs` (which
 * assigns them to each declared command) and `feedback.mjs` (which reads
 * them back out of `.harness/verify-report.json`).
 *
 * Task-18-brief.md section B1 (measured against the real feedback scorer
 * before this module existed): a hand-duplicated notion of "does this
 * status count as evidence" in two files is exactly the "manually synced
 * parallel list" class of bug this project has already been bitten by four
 * times (PRUNE_DIRS/DEFAULT_IGNORE in scan.mjs, docker.runtimePins/manifest
 * and CONTAINER_FILES in stack.mjs/environment.mjs, the CI-workflow globs)
 * — every one of those was fixed by deriving from a single source, never by
 * keeping two lists in sync by hand. This module is that single source for
 * verify statuses: both consumers import `isExecutedStatus` rather than
 * each re-deriving their own "which strings mean it actually ran" logic.
 *
 * `PLANNED` and `BLOCKED` both mean the command was never spawned:
 *   - PLANNED: dry-run mode. The command passed the safety check and would
 *     have run under `--run`, but nothing was actually executed.
 *   - BLOCKED: the command matched the safety blocklist and was refused,
 *     in *any* mode (see safety.mjs / exec.mjs's hard ordering: checkCommand
 *     always runs before runCommand ever gets a chance to exist).
 * `PASSED` / `FAILED` / `TIMEOUT` all mean the command WAS spawned via
 * `runCommand` and its real outcome was actually observed.
 *
 * The bug this module exists to close: feeding a PLANNED or BLOCKED status
 * into a check like "did the test command fail" reads a command this tool
 * refused to run (or simply hadn't gotten around to running yet) as an
 * *observed failure* — telling a user their test suite "failed" when it
 * never executed at all. Measured directly against the real feedback
 * scorer before this fix (task-18-brief.md section B1): a `harness.config.json`
 * declaring a command this tool's own safety boundary blocks (e.g. an
 * `rm -rf` in a `test` role) produced `feedback.commands-failing` — this
 * tool reporting its own safety refusal back to the user as if it were the
 * user's bug. That inverts the project's own "absent evidence != negative
 * evidence" contract, and does it with commands the safety boundary itself
 * refused to run.
 */
export const VERIFY_STATUS = Object.freeze({
  PLANNED: 'planned',
  BLOCKED: 'blocked',
  PASSED: 'passed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
});

const EXECUTED = new Set([VERIFY_STATUS.PASSED, VERIFY_STATUS.FAILED, VERIFY_STATUS.TIMEOUT]);

/**
 * True iff `status` means the command was actually spawned via
 * `runCommand` and its real outcome was observed — as opposed to PLANNED
 * or BLOCKED, neither of which ever reached `runCommand` at all. This is
 * the single predicate every consumer must derive "is there real evidence
 * here" from, rather than re-deriving an equivalent condition of its own
 * that could quietly drift out of sync with this one (see the file-level
 * comment). Returns false for any unrecognized/malformed status, including
 * `null`/`undefined` — a hand-edited or older-schema report should degrade
 * to "no evidence", the same posture this project takes everywhere else
 * evidence is questionable rather than trustworthy.
 */
export function isExecutedStatus(status) {
  return EXECUTED.has(status);
}
