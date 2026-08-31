import { parseMarkdown, findSection } from '../markdown.mjs';
import { ladder } from './ladder.mjs';
import { isFilledArtifact } from '../placeholder.mjs';
import { MAX_SCORE } from '../rubric.mjs';

export const id = 'state';

const PROGRESS_FILES = ['PROGRESS.md', 'claude-progress.md', 'docs/PROGRESS.md'];
const DONE_RE = /done|complete|完成/i;
const IN_PROGRESS_RE = /progress|doing|进行/i;
const BLOCKED_RE = /block|阻塞/i;
const LIFECYCLE_RE = /session start|session end|会话开始|会话结束/i;

const STATUSES = new Set(['todo', 'in-progress', 'done', 'blocked']);

/**
 * Minimal hand-rolled feature_list.json validator (zero dependencies, no
 * JSON-schema library). Returns an array of human-readable problem strings;
 * empty means valid. A top-level value that parses as JSON but isn't a
 * `{features: [...]}` shape (an array, a string, a bare object with no
 * `features` array, ...) is reported as a single problem rather than
 * crashing — `typeof [] === 'object'` and `data.features` on a non-object
 * are both handled by the same guard.
 */
export function validateFeatureList(data) {
  const problems = [];
  if (!data || typeof data !== 'object' || !Array.isArray(data.features)) {
    return ['features must be an array'];
  }
  const seen = new Set();
  data.features.forEach((f, i) => {
    if (typeof f?.id !== 'string' || f.id === '') problems.push(`features[${i}].id must be a non-empty string`);
    else if (seen.has(f.id)) problems.push(`duplicate feature id: ${f.id}`);
    else seen.add(f.id);
    if (typeof f?.title !== 'string' || f.title === '') problems.push(`features[${i}].title must be a non-empty string`);
    if (!STATUSES.has(f?.status)) problems.push(`features[${i}].status must be one of ${[...STATUSES].join(', ')}`);
  });
  return problems;
}

/**
 * The two artefacts the rung-4 handoff check is about, and the evidence note
 * each one earns once it is genuinely filled in. Single source for the
 * classification loop, the evidence list and the per-gap attribution below,
 * so no two of those three can drift apart the way this codebase's
 * hand-synced lists have four times before.
 */
const HANDOFF_ARTEFACTS = [
  { name: 'session-handoff.md', note: 'handoff doc' },
  { name: 'clean-state-checklist.md', note: 'checklist' },
];

/**
 * Classify a handoff artefact's presence at the repo root or at any depth
 * beneath it, returning `{ state, path }` where `state` is one of:
 *
 *   - 'absent'   -- no file named `name` exists anywhere in the repository.
 *                   `path` is null: there is no file to point at.
 *   - 'unfilled' -- at least one copy exists, but no copy reads as filled in
 *                   (see placeholder.mjs's isFilledArtifact). `path` is the
 *                   first copy found, so the report can name a real path.
 *   - 'filled'   -- at least one copy exists and is a real, filled-in
 *                   artefact. `path` is that copy.
 *
 * `path` exists so the report can attribute each of the two rung-4 gaps to
 * the specific artefact that caused it. Before it did, a repository with one
 * artefact missing and the other still a template got both gap ids, each
 * naming BOTH files unconditionally -- so the same report told the user to
 * open a file it had just said was missing, and to add a file that was
 * already there.
 *
 * The any-depth search is deliberate and unchanged from before this file
 * gained placeholder detection — a repository keeping its handoff doc at
 * docs/session-handoff.md should get credit for it. A repository can have
 * BOTH a leftover vendored/unfilled copy (e.g. under templates/) AND its own
 * real, filled-in copy elsewhere; that combination classifies as 'filled',
 * since every candidate path is checked rather than stopping at the first
 * one found — this preserves exactly what the old boolean `hasHandoff`/
 * `hasChecklist` computed (see git history) before this function split that
 * boolean into three states so 'absent' and 'unfilled' can be told apart.
 *
 * The root `ctx.exists` check feeds the same candidate set the glob does,
 * for the same reason it always has: `ctx.list` respects the config's
 * ignore patterns and `ctx.exists` does not, so a root-level artefact
 * inside an ignored path is still a candidate.
 *
 * Adding `path` also means a `state.no-handoff` for one artefact and a
 * `state.handoff-unfilled` for the other are now two attributable facts
 * rather than two sentences that each name both files.
 */
function classifyHandoffArtefact(ctx, name) {
  // The root copy is seeded FIRST so that, when several copies qualify, the
  // one this report names is the canonical one rather than whichever path
  // the glob happened to sort first. Iteration order decides only which
  // path is reported, never the state -- 'filled' still means "any copy is
  // filled" and 'unfilled' still means "no copy is" regardless of order.
  // Without this, assessing this very repository reported its handoff
  // evidence at a copy inside an untracked stale worktree directory, which
  // is both useless to a reader and machine-specific.
  const candidates = new Set();
  if (ctx.exists(name)) candidates.add(name);
  for (const rel of ctx.list([`**/${name}`])) candidates.add(rel);
  if (candidates.size === 0) return { state: 'absent', path: null };
  for (const rel of candidates) {
    if (isFilledArtifact(ctx, rel)) return { state: 'filled', path: rel };
  }
  return { state: 'unfilled', path: [...candidates][0] };
}

export function score({ ctx, now }) {
  const file = PROGRESS_FILES.find((f) => ctx.exists(f));
  const hasProgressFile = file !== undefined;

  const raw = hasProgressFile ? (ctx.read(file) ?? '') : '';
  // Table's freshness formula: git history wins when available (it reflects
  // when the content actually changed), falling back to filesystem mtime
  // only when there's no commit history for the file (e.g. an unstaged
  // local edit, or a repo scanned outside of git).
  const ts = hasProgressFile ? (ctx.gitLastCommit(file) ?? ctx.mtime(file)) : null;
  const fresh = ts !== null && (now - ts) <= 30 * 864e5;

  const md = parseMarkdown(raw);
  const hasDoneSection = findSection(md, DONE_RE) !== null;
  const hasInProgressSection = findSection(md, IN_PROGRESS_RE) !== null;
  const hasBlockedSection = findSection(md, BLOCKED_RE) !== null;
  const hasAllThreeSections = hasDoneSection && hasInProgressSection && hasBlockedSection;

  const hasFeatureListFile = ctx.exists('feature_list.json');
  const featureListData = hasFeatureListFile ? ctx.readJson('feature_list.json') : null;
  const featureListValid = hasFeatureListFile && validateFeatureList(featureListData).length === 0;

  const handoff = HANDOFF_ARTEFACTS.map((a) => ({ ...a, ...classifyHandoffArtefact(ctx, a.name) }));
  const inState = (s) => handoff.filter((a) => a.state === s);
  // Absent artefacts have no path, so the canonical name is all there is to
  // name. Unfilled ones are named at the path they were actually found at:
  // the user has to open THAT file, and a vendored template living at
  // docs/clean-state-checklist.md would otherwise be reported at a root path
  // that does not exist.
  const absentArtefacts = inState('absent').map((a) => a.name);
  const unfilledArtefacts = inState('unfilled').map((a) => a.path);
  // state.no-handoff fires when either artefact is missing outright;
  // state.handoff-unfilled fires when every existing copy of either
  // artefact is still a placeholder. A repository can trip both at once
  // (one artefact absent, the other present-but-unfilled) -- that is an
  // accurate report of two distinct problems, not a bug, so the two checks
  // below are independent rather than one superseding the other. Which
  // artefact caused which gap is carried through in gapVars below, so the
  // two texts name different files instead of both naming both.
  const anyHandoffAbsent = absentArtefacts.length > 0;
  const anyHandoffUnfilled = unfilledArtefacts.length > 0;
  // Only AGENTS.md is checked here (not CLAUDE.md as instructions/tools do)
  // — the table names AGENTS.md specifically for the session-lifecycle
  // check. This is a plain full-text search over the raw body, not a
  // heading match (unlike the done/in-progress/blocked sections above,
  // which the table explicitly calls "标题匹配"): a lifecycle description
  // mentioned in ordinary prose, with no dedicated heading, still counts.
  const agentsRaw = ctx.read('AGENTS.md') ?? '';
  const lifecycleDocumented = LIFECYCLE_RE.test(agentsRaw);

  const { score, gapIds } = ladder([
    { score: 1, checks: [{ ok: hasProgressFile, gapId: 'state.no-progress' }] },
    { score: 2, checks: [
      { ok: fresh, gapId: 'state.progress-stale' },
      { ok: hasAllThreeSections, gapId: 'state.progress-incomplete' },
    ] },
    { score: 3, checks: [
      { ok: hasFeatureListFile, gapId: 'state.no-feature-list' },
      { ok: !hasFeatureListFile || featureListValid, gapId: 'state.feature-list-invalid' },
    ] },
    { score: MAX_SCORE, checks: [
      { ok: !anyHandoffAbsent, gapId: 'state.no-handoff' },
      { ok: !anyHandoffUnfilled, gapId: 'state.handoff-unfilled' },
      { ok: lifecycleDocumented, gapId: 'state.lifecycle-undocumented' },
    ] },
  ]);

  const evidence = [];
  if (hasProgressFile) evidence.push({ kind: 'file', path: file, note: fresh ? 'fresh' : 'stale' });
  if (hasFeatureListFile) {
    const count = Array.isArray(featureListData?.features) ? featureListData.features.length : 0;
    evidence.push({ kind: 'file', path: 'feature_list.json', note: featureListValid ? `${count} features` : 'invalid' });
  }
  // Every handoff artefact that exists on disk is recorded, not only the
  // filled ones, and at the path it was actually found at rather than at
  // its canonical root name. An unfilled artefact is a real file the user
  // can open; leaving it out of the evidence array made the JSON report
  // indistinguishable from one where the file was missing outright, which
  // is precisely the distinction state.handoff-unfilled exists to draw.
  // 'absent' contributes nothing: there is no path to point at.
  for (const a of handoff) {
    if (a.state === 'absent') continue;
    evidence.push({ kind: 'file', path: a.path, note: a.state === 'filled' ? a.note : 'unfilled template' });
  }
  if (lifecycleDocumented) evidence.push({ kind: 'file', path: 'AGENTS.md', note: 'session lifecycle documented' });

  // Every condition in this table is a fact about repository state (file
  // existence, freshness, JSON schema, prose content) — none of it depends
  // on whether some command was actually run and observed to pass, unlike
  // Environment's bootstrap-verification rung. So state scoring never needs
  // evidence-capping: cappedByEvidence is always false here.
  //
  // gapVars carries per-gap interpolation values through to buildReport, so
  // the two handoff gaps can each name the artefact that actually caused
  // them. Only supplied for a gap that is genuinely in gapIds; buildReport
  // throws if a message needs a variable nobody supplied, so an unsupplied
  // key can never silently render as a literal "{artefacts}".
  const gapVars = {};
  if (anyHandoffAbsent) gapVars['state.no-handoff'] = { artefacts: absentArtefacts.join(', ') };
  if (anyHandoffUnfilled) gapVars['state.handoff-unfilled'] = { artefacts: unfilledArtefacts.join(', ') };

  return { score, cappedByEvidence: false, evidence, gapIds, gapVars };
}
