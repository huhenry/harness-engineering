import { CliError } from './cli.mjs';
import { analyzeLoopText } from './loop-facts.mjs';
import { gapById } from './rubric.mjs';

export const DEFAULT_PROFILE = 'repository';
export const SUPPORTED_PROFILES = ['repository', 'harness-distribution'];

/** Resolve the optional CLI/library value to one canonical profile id. */
export function assertProfile(raw) {
  const profile = raw ?? DEFAULT_PROFILE;
  if (!SUPPORTED_PROFILES.includes(profile)) {
    throw new CliError(
      `Invalid --profile '${profile}': expected one of ${SUPPORTED_PROFILES.join(', ')}.`,
    );
  }
  return profile;
}

const SKILL_GLOBS = ['**/skills/**/SKILL.md'];
const AGENT_GLOBS = ['**/agents/*.md'];
const WORKFLOW_GLOBS = ['**/workflows/*'];

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function isGitHubWorkflow(path) {
  const parts = path.split('/');
  return parts.some((part, index) => part === '.github' && parts[index + 1] === 'workflows');
}

/** Discover installable harness sources at the root or below a bundle
 * prefix such as `harness/`. GitHub CI is deliberately not a distribution
 * workflow and stays under Feedback's existing ownership. */
export function discoverHarnessDistribution(ctx) {
  const skillFiles = uniqueSorted(ctx.list(SKILL_GLOBS));
  const agentFiles = uniqueSorted(ctx.list(AGENT_GLOBS));
  const workflowFiles = uniqueSorted(ctx.list(WORKFLOW_GLOBS).filter((path) => !isGitHubWorkflow(path)));
  const files = uniqueSorted([...skillFiles, ...agentFiles, ...workflowFiles]);
  const readable = files.map((path) => ({ path, text: ctx.read(path) })).filter((item) => item.text !== null);
  const readableFiles = readable.map((item) => item.path);
  const readableSet = new Set(readableFiles);
  return {
    skillFiles,
    agentFiles,
    workflowFiles,
    readableFiles,
    readableAgentFiles: agentFiles.filter((path) => readableSet.has(path)),
    readableWorkflowFiles: workflowFiles.filter((path) => readableSet.has(path)),
    text: readable.map((item) => item.text).join('\n'),
  };
}

const MAKER_ROLE_RE = /(^|[^a-z])(maker|producer|worker)([^a-z]|$)/i;
const CHECKER_ROLE_RE = /(^|[^a-z])(checker|reviewer|verifier|qa|skeptic)([^a-z]|$)/i;

function hasRolePair(ctx, agentFiles) {
  const roleTexts = agentFiles.map((path) => `${path}\n${ctx.read(path) ?? ''}`);
  return roleTexts.some((text) => MAKER_ROLE_RE.test(text))
    && roleTexts.some((text) => CHECKER_ROLE_RE.test(text));
}

function distributionEvidence(distribution) {
  const readable = new Set(distribution.readableFiles);
  return [
    ...distribution.skillFiles.filter((path) => readable.has(path))
      .map((path) => ({ kind: 'file', path, note: 'harness distribution skill' })),
    ...distribution.agentFiles.filter((path) => readable.has(path))
      .map((path) => ({ kind: 'file', path, note: 'harness distribution agent role' })),
    ...distribution.workflowFiles.filter((path) => readable.has(path))
      .map((path) => ({ kind: 'file', path, note: 'harness distribution workflow definition' })),
  ];
}

/** Profile analysis returns diagnostics only. There is intentionally no
 * score-shaped field in this object; applyDiagnosticOverlay rejects one if
 * a future caller attempts to smuggle it in. */
export function profileOverlay({ profile, ctx }) {
  const canonical = assertProfile(profile);
  if (canonical === DEFAULT_PROFILE) return {};

  const distribution = discoverHarnessDistribution(ctx);
  const facts = analyzeLoopText(distribution.text);
  const makerChecker = facts.hasMakerChecker || hasRolePair(ctx, distribution.readableAgentFiles);
  const resolvedGapIds = [];
  if (facts.hasKeyword) resolvedGapIds.push('loop.none');
  if (distribution.readableWorkflowFiles.length > 0) resolvedGapIds.push('loop.no-entrypoint');
  if (facts.hasStopCondition) resolvedGapIds.push('loop.no-stop-condition');
  if (facts.hasBudgetCap) resolvedGapIds.push('loop.no-budget-cap');
  if (makerChecker) resolvedGapIds.push('loop.no-maker-checker');
  if (facts.hasRollback) resolvedGapIds.push('loop.no-rollback');

  return {
    loop: {
      resolvedGapIds,
      evidence: distributionEvidence(distribution),
    },
  };
}

function evidenceKey(item) {
  return `${item.kind ?? ''}\0${item.path ?? ''}\0${item.note ?? ''}`;
}

/** Apply a profile's diagnostic facts without granting it access to scores,
 * evidence caps, gap variables, or any other scoring input. */
export function applyDiagnosticOverlay(results, overlay) {
  const next = Object.fromEntries(Object.entries(results).map(([id, result]) => [id, {
    ...result,
    gapIds: [...result.gapIds],
    evidence: [...result.evidence],
  }]));

  for (const [subsystem, patch] of Object.entries(overlay)) {
    if (!Object.hasOwn(next, subsystem)) throw new Error(`Profile overlay names unknown subsystem: ${subsystem}`);
    const unsupported = Object.keys(patch).filter((key) => !['resolvedGapIds', 'evidence'].includes(key));
    if (unsupported.length > 0) {
      throw new Error(`Profile overlay for ${subsystem} contains unsupported fields: ${unsupported.join(', ')}`);
    }
    const resolved = new Set(patch.resolvedGapIds ?? []);
    for (const gapId of resolved) {
      const gap = gapById(gapId);
      if (gap.subsystem !== subsystem) {
        throw new Error(`Profile overlay for ${subsystem} cannot resolve ${gapId}`);
      }
    }
    next[subsystem].gapIds = next[subsystem].gapIds.filter((gapId) => !resolved.has(gapId));
    const evidence = [...next[subsystem].evidence, ...(patch.evidence ?? [])];
    const byKey = new Map(evidence.map((item) => [evidenceKey(item), item]));
    next[subsystem].evidence = [...byKey.values()].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
  }
  return next;
}
