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
 * Classify a handoff artefact's presence at the repo root or at any depth
 * beneath it, as one of:
 *
 *   - 'absent'   -- no file named `name` exists anywhere in the repository.
 *   - 'unfilled' -- at least one copy exists, but every copy is still a
 *                   placeholder (an unreplaced `FILL:` marker, or
 *                   byte-identical to one of this project's shipped
 *                   templates -- see placeholder.mjs's isFilledArtifact).
 *   - 'filled'   -- at least one copy exists and is a real, filled-in
 *                   artefact.
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
 */
function classifyHandoffArtefact(ctx, name) {
  const candidates = new Set(ctx.list([`**/${name}`]));
  if (ctx.exists(name)) candidates.add(name);
  if (candidates.size === 0) return 'absent';
  for (const rel of candidates) {
    if (isFilledArtifact(ctx, rel)) return 'filled';
  }
  return 'unfilled';
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

  const handoffState = classifyHandoffArtefact(ctx, 'session-handoff.md');
  const checklistState = classifyHandoffArtefact(ctx, 'clean-state-checklist.md');
  const hasHandoff = handoffState === 'filled';
  const hasChecklist = checklistState === 'filled';
  // state.no-handoff fires when either artefact is missing outright;
  // state.handoff-unfilled fires when every existing copy of either
  // artefact is still a placeholder. A repository can trip both at once
  // (one artefact absent, the other present-but-unfilled) -- that is an
  // accurate report of two distinct problems, not a bug, so the two checks
  // below are independent rather than one superseding the other.
  const anyHandoffAbsent = handoffState === 'absent' || checklistState === 'absent';
  const anyHandoffUnfilled = handoffState === 'unfilled' || checklistState === 'unfilled';
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
  if (hasHandoff) evidence.push({ kind: 'file', path: 'session-handoff.md', note: 'handoff doc' });
  if (hasChecklist) evidence.push({ kind: 'file', path: 'clean-state-checklist.md', note: 'checklist' });
  if (lifecycleDocumented) evidence.push({ kind: 'file', path: 'AGENTS.md', note: 'session lifecycle documented' });

  // Every condition in this table is a fact about repository state (file
  // existence, freshness, JSON schema, prose content) — none of it depends
  // on whether some command was actually run and observed to pass, unlike
  // Environment's bootstrap-verification rung. So state scoring never needs
  // evidence-capping: cappedByEvidence is always false here.
  return { score, cappedByEvidence: false, evidence, gapIds };
}
