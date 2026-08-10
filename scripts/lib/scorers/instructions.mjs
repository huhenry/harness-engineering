import { parseMarkdown, findSection } from '../markdown.mjs';
import { ladder } from './ladder.mjs';

export const id = 'instructions';

const VERSION_LINE = /\b\d+\.\d+/;
const SETUP = /setup|install|getting started|快速开始|安装/i;
const CONSTRAINTS = /constraint|never|forbidden|约束|禁止/i;
const VERIFY = /verif|check|test|验证|检查/i;

/** Escape a string for safe interpolation into a RegExp source. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A local link target may carry a `#section` fragment (e.g.
 * `docs/architecture.md#setup`) — the fragment addresses a heading inside the
 * target file, it is not part of the file's path. Stripping it before any
 * filesystem check is what makes deep-linking into a sub-document behave the
 * same as linking to its top, instead of being misreported as a stale link
 * (or as "not layering") purely because of the anchor.
 */
function linkPath(target) {
  return target.split('#')[0];
}

/**
 * True when `line` names one of the repo's detected stack technologies
 * (e.g. 'go', 'node') as a whole word, case-insensitively. Table condition:
 * a stack version is only "pinned" when the version number sits on a line
 * that also names the stack — a bare `\d+\.\d+` alone (a section number, an
 * issue number, ...) proves nothing about the stack.
 */
function mentionsStack(line, stack) {
  return stack.some((s) => new RegExp(`\\b${escapeRegExp(s)}\\b`, 'i').test(line));
}

export function score({ ctx, stack }) {
  const file = ['AGENTS.md', 'CLAUDE.md'].find((f) => ctx.exists(f));
  if (!file) {
    return { score: 0, cappedByEvidence: false, evidence: [], gapIds: ['instructions.missing'] };
  }
  const raw = ctx.read(file) ?? '';
  const md = parseMarkdown(raw);
  const hasVersions = raw
    .split('\n')
    .some((l) => VERSION_LINE.test(l) && mentionsStack(l, stack));
  const hasSetup = findSection(md, SETUP) !== null;
  const hasConstraints = findSection(md, CONSTRAINTS) !== null;
  const hasVerify = findSection(md, VERIFY) !== null;
  const withinLength = md.lineCount <= 150;
  // "子目录" (subdirectory) in the table is deliberate: a link to a root-level
  // .md file (README.md, CONTRIBUTING.md, ...) says nothing about layered,
  // per-subproject instructions, so it must not satisfy this check.
  const layered = md.localLinks.some((l) => {
    const p = linkPath(l.target);
    return p.endsWith('.md') && p.includes('/');
  });
  const linksResolve = md.localLinks.every((l) => ctx.exists(linkPath(l.target)));

  const { score, gapIds } = ladder([
    { score: 1, checks: [] },
    { score: 2, checks: [
      { ok: hasVersions, gapId: 'instructions.no-stack-versions' },
      { ok: hasSetup, gapId: 'instructions.no-setup-commands' },
    ] },
    { score: 3, checks: [
      { ok: hasConstraints, gapId: 'instructions.no-constraints' },
      { ok: hasVerify, gapId: 'instructions.no-constraints' },
      { ok: withinLength, gapId: 'instructions.too-long' },
    ] },
    { score: 4, checks: [
      { ok: layered, gapId: 'instructions.no-layering' },
      { ok: linksResolve, gapId: 'instructions.stale-links' },
    ] },
  ]);

  return {
    score,
    cappedByEvidence: false,
    evidence: [{ kind: 'file', path: file, note: `${md.lineCount} lines, ${md.headings.length} headings` }],
    gapIds,
  };
}
