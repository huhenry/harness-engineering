import { ladder } from './ladder.mjs';
import { signatureFor } from '../stack.mjs';

export const id = 'environment';

const BOOTSTRAP_SCRIPTS = ['init.sh', 'bootstrap.sh', 'scripts/setup.sh'];
// Derived from docker's own manifest list rather than hand-maintained as a
// parallel copy: any repository stack.mjs recognises as 'docker' (via any
// of its manifest filenames) must also count as containerized here, or the
// tool tells a user who has containerized their project that they haven't.
// A hand-synced duplicate of this list previously drifted (it only listed
// 'docker-compose.yml', not the other three Compose spellings), producing
// exactly that broken-feedback-loop bug for 'compose.yml'-only repos —
// deriving it closes off that entire class of drift permanently.
const CONTAINER_FILES = [...(signatureFor('docker')?.manifest ?? []), '.devcontainer/devcontainer.json'];

/** The verifyReport's bootstrap-role command entry, or null if none exists. */
function bootstrapCommandFrom(verifyReport) {
  if (!verifyReport || !Array.isArray(verifyReport.commands)) return null;
  return verifyReport.commands.find((c) => c && c.role === 'bootstrap') ?? null;
}

export function score({ ctx, stack, config, verifyReport }) {
  const sigs = stack.map((s) => signatureFor(s)).filter(Boolean);

  const lockfilePresent = (sig) => sig.lockfiles.some((f) => ctx.exists(f));
  const runtimePinPresent = (sig) => sig.runtimePins.some((f) => ctx.exists(f));

  // Rung 1's condition is evaluated on the raw per-stack signal (no lockfile
  // vacuous-exclusion here): a stack has *something* pinning its environment
  // as soon as either its lockfile or its runtime pin is present. The table
  // gives no gap id for this rung failing, so a repo with zero signal at all
  // (including the no-stack-detected case, stack === []) reports score 0
  // with no gap — there is nothing specific yet to point a fix at.
  const anyLockOrPin = sigs.some((sig) => lockfilePresent(sig) || runtimePinPresent(sig));
  if (!anyLockOrPin) {
    return { score: 0, cappedByEvidence: false, evidence: [], gapIds: [] };
  }

  // Rung 2 aggregates across every detected stack rather than requiring a
  // single stack to have both: a polyglot repo where Node's lockfile is
  // present and Python's runtime pin is present (but not vice versa) still
  // demonstrates real environment-pinning discipline overall. Stacks whose
  // signature declares no lockfile concept at all (lockfiles: [], e.g.
  // docker) are excluded from the lockfile requirement entirely rather than
  // counted as failing it — a Dockerfile-only repo has no file it could ever
  // produce to satisfy this, so requiring one would penalise every
  // container-only repository for something structurally impossible.
  const lockfileCapableSigs = sigs.filter((sig) => sig.lockfiles.length > 0);
  const lockfileOk = lockfileCapableSigs.length === 0 || lockfileCapableSigs.some(lockfilePresent);
  const runtimePinOk = sigs.some(runtimePinPresent);

  const configBootstrap = typeof config?.verify?.bootstrap === 'string' && config.verify.bootstrap.trim() !== ''
    ? config.verify.bootstrap
    : null;
  const bootstrapScriptFile = BOOTSTRAP_SCRIPTS.find((f) => ctx.exists(f)) ?? null;
  const hasBootstrapScript = configBootstrap !== null || bootstrapScriptFile !== null;
  const bootstrapCommandLabel = configBootstrap ?? bootstrapScriptFile;

  const containerFile = CONTAINER_FILES.find((f) => ctx.exists(f)) ?? null;
  const hasContainer = containerFile !== null;

  const bootstrapCmd = bootstrapCommandFrom(verifyReport);
  // "Verified" means we have actual evidence to judge, one way or the other
  // — a supplied verifyReport that recorded a bootstrap-role command run.
  const verified = verifyReport != null && bootstrapCmd !== null;
  const bootstrapPassed = verified && bootstrapCmd.status === 'passed';

  const { score, gapIds: ladderGaps } = ladder([
    { score: 1, checks: [] },
    { score: 2, checks: [
      { ok: lockfileOk, gapId: 'environment.no-lockfile' },
      { ok: runtimePinOk, gapId: 'environment.no-runtime-pin' },
    ] },
    { score: 3, checks: [
      { ok: hasBootstrapScript, gapId: 'environment.no-bootstrap' },
    ] },
    { score: 4, checks: [
      { ok: hasContainer, gapId: 'environment.no-container' },
      { ok: bootstrapPassed, gapId: 'environment.bootstrap-fails' },
    ] },
  ]);

  const evidence = [];
  for (const sig of sigs) {
    const lock = sig.lockfiles.find((f) => ctx.exists(f));
    if (lock) evidence.push({ kind: 'file', path: lock, note: `${sig.id} lockfile` });
    const pin = sig.runtimePins.find((f) => ctx.exists(f));
    if (pin) evidence.push({ kind: 'file', path: pin, note: `${sig.id} runtime pin` });
  }
  if (bootstrapScriptFile) evidence.push({ kind: 'file', path: bootstrapScriptFile, note: 'bootstrap script' });
  if (containerFile) evidence.push({ kind: 'file', path: containerFile, note: 'container file' });

  let gapIds = ladderGaps;
  let cappedByEvidence = false;
  if (!verified) {
    // A claim without evidence is not a failure: nobody ran the bootstrap
    // command (or the supplied report says nothing about it), so we cannot
    // say it failed. The ladder's score already reflects the unmet
    // condition (bootstrapPassed is false whenever unverified) — what we
    // must not do is let the *specific* failure gap survive, since that
    // would assert a failure nobody observed.
    gapIds = gapIds.filter((g) => g !== 'environment.bootstrap-fails');
    // cappedByEvidence is only meaningful when the lack of evidence is
    // actually what's holding the score back — i.e. every other rung-4
    // condition is already satisfied and bootstrap verification is the sole
    // missing piece. If the repo would fail rung 4 anyway (e.g. no
    // container file), the cap isn't "by evidence", it's a genuine gap.
    if (lockfileOk && runtimePinOk && hasBootstrapScript && hasContainer) cappedByEvidence = true;
    if (bootstrapCommandLabel) evidence.push({ kind: 'command', path: bootstrapCommandLabel, note: 'not verified' });
  }

  return { score, cappedByEvidence, evidence, gapIds };
}
