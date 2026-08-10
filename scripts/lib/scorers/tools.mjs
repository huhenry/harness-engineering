import { parseMarkdown } from '../markdown.mjs';
import { ladder } from './ladder.mjs';

export const id = 'tools';

// Coarse "is the entrypoint mentioned at all" check (rung 2): a literal
// substring test over the whole instructions body, matching the table's own
// wording ("出现 make / just / task / npm run 字样"). Case-sensitive on
// purpose — this only needs to catch genuine shell invocations, which are
// conventionally lowercase, not capitalized prose like "Make sure...".
const ENTRY_MENTION = /\b(make|just|task)\s+\S|\bnpm run\b/;

// Fine-grained "which target/script name was invoked" extraction (rung 3),
// scoped to code-ish spans only (fenced code blocks + inline `code`) rather
// than the full prose body. Matching over raw prose would treat ordinary
// English like "make sure" or "task ahead" as a dangling reference to a
// target named "sure" — restricting to code spans is what keeps this a
// reasonable heuristic instead of a false-positive generator.
const REF_RE = /\b(make|just|task)\s+([A-Za-z0-9_.:/-]+)|\bnpm run\s+([A-Za-z0-9_.:/-]+)/g;

const ALLOW_RE = /\ballow(ed)?\b|允许/i;
const DENY_RE = /\bden(y|ied)\b|\bforbid(den)?\b|禁止|禁用/i;

/** Extract inline `code` spans and fenced code block bodies as one blob. */
function codeishText(raw, md) {
  const inline = [...raw.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const blocks = md.codeBlocks.map((b) => b.code);
  return [...inline, ...blocks].join('\n');
}

/**
 * Makefile target names. Only unindented `name:` definition lines count —
 * recipe lines are tab-indented and `VAR := value` / `VAR = value`
 * assignments are excluded via the `(?!=)` lookahead. `.PHONY` and other
 * dot-prefixed special targets are not real invocation targets, so they're
 * dropped too.
 */
function extractMakeTargets(text) {
  if (!text) return [];
  const names = [];
  for (const line of text.split('\n')) {
    if (/^\s/.test(line) || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_./-]+)\s*:(?!=)/);
    if (m && !m[1].startsWith('.')) names.push(m[1]);
  }
  return [...new Set(names)];
}

/** justfile recipe names: unindented `name [params]:` definition lines. */
function extractJustRecipes(text) {
  if (!text) return [];
  const names = [];
  for (const line of text.split('\n')) {
    if (/^\s/.test(line) || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\b[^:=\n]*:(?!=)/);
    if (m) names.push(m[1]);
  }
  return [...new Set(names)];
}

/**
 * Taskfile.yml (go-task) task names: keys directly under a top-level
 * `tasks:` map. This is a hand-rolled scan, not a YAML parser (zero
 * dependencies) — it tracks the indentation of the first task entry and:
 *   - treats any MORE-indented line (cmds:, deps:, list items, ...) as
 *     nested content to skip over without ending the block, and
 *   - treats any LESS-indented line as a dedent out of the tasks section.
 * Only lines at exactly that indentation are read as `name:` task entries,
 * so a task's nested cmds list can never be mistaken for a sibling task and
 * can never truncate the scan before later tasks are reached.
 */
function extractTaskNames(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /^tasks:\s*$/.test(l));
  if (idx === -1) return [];
  let indent = null;
  const names = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const leading = line.match(/^\s*/)[0].length;
    if (indent === null) {
      if (leading === 0) break;
      indent = leading;
    }
    if (leading < indent) break;
    if (leading > indent) continue;
    const m = line.match(/^\s+([A-Za-z0-9_.:-]+):/);
    if (m) names.push(m[1]);
  }
  return [...new Set(names)];
}

/** Extract every make/just/task/npm-run reference from code-ish spans. */
function extractReferences(codeish) {
  const refs = [];
  for (const m of codeish.matchAll(REF_RE)) {
    if (m[1]) refs.push({ verb: m[1], name: m[2] });
    else refs.push({ verb: 'npm', name: m[3] });
  }
  return refs;
}

function hasLeastPrivilegeDoc(ctx, instructionsRaw) {
  const settings = ctx.readJson('.claude/settings.json');
  if (settings && typeof settings === 'object') {
    const perms = settings.permissions;
    if (perms && typeof perms === 'object') {
      const allowOk = Array.isArray(perms.allow) && perms.allow.length > 0;
      const denyOk = Array.isArray(perms.deny) && perms.deny.length > 0;
      if (allowOk && denyOk) return true;
    }
  }
  // Fallback: a documented allow/deny list, either in the permissions file
  // itself (e.g. .cursor/rules, which is free-form text) or in the
  // instructions doc.
  const rulesRaw = ctx.read('.cursor/rules') ?? '';
  const combined = `${rulesRaw}\n${instructionsRaw ?? ''}`;
  return ALLOW_RE.test(combined) && DENY_RE.test(combined);
}

export function score({ ctx }) {
  const hasMakefile = ctx.exists('Makefile');
  const hasJustfile = ctx.exists('justfile');
  const hasTaskfile = ctx.exists('Taskfile.yml');
  const pkg = ctx.readJson('package.json');
  const pkgScripts = pkg && typeof pkg === 'object' && pkg.scripts && typeof pkg.scripts === 'object'
    ? pkg.scripts
    : null;
  const hasPkgScripts = pkgScripts !== null && Object.keys(pkgScripts).length > 0;
  const hasEntrypoint = hasMakefile || hasJustfile || hasTaskfile || hasPkgScripts;

  const makeTargets = hasMakefile ? extractMakeTargets(ctx.read('Makefile')) : null;
  const justRecipes = hasJustfile ? extractJustRecipes(ctx.read('justfile')) : null;
  const taskNames = hasTaskfile ? extractTaskNames(ctx.read('Taskfile.yml')) : null;
  const npmScripts = hasPkgScripts ? Object.keys(pkgScripts) : null;
  const declaredByVerb = { make: makeTargets, just: justRecipes, task: taskNames, npm: npmScripts };

  const instructionsFile = ['AGENTS.md', 'CLAUDE.md'].find((f) => ctx.exists(f));
  const instructionsRaw = instructionsFile ? (ctx.read(instructionsFile) ?? '') : '';
  const referencedInAgents = ENTRY_MENTION.test(instructionsRaw);

  const md = parseMarkdown(instructionsRaw);
  const references = extractReferences(codeishText(instructionsRaw, md));
  const noDanglingRefs = references.every((r) => {
    const declared = declaredByVerb[r.verb];
    return declared !== null && declared.includes(r.name);
  });

  const hasPermissionsFile = ctx.exists('.claude/settings.json') || ctx.exists('.cursor/rules');
  const leastPrivilegeOk = hasLeastPrivilegeDoc(ctx, instructionsRaw);

  const { score, gapIds } = ladder([
    { score: 1, checks: [{ ok: hasEntrypoint, gapId: 'tools.no-entrypoint' }] },
    { score: 2, checks: [{ ok: referencedInAgents, gapId: 'tools.no-entrypoint' }] },
    { score: 3, checks: [
      { ok: noDanglingRefs, gapId: 'tools.broken-entrypoint' },
      { ok: hasPermissionsFile, gapId: 'tools.no-permissions' },
    ] },
    { score: 4, checks: [{ ok: leastPrivilegeOk, gapId: 'tools.no-least-privilege-doc' }] },
  ]);

  const evidence = [];
  if (hasMakefile) evidence.push({ kind: 'file', path: 'Makefile', note: `${makeTargets.length} targets` });
  if (hasJustfile) evidence.push({ kind: 'file', path: 'justfile', note: `${justRecipes.length} recipes` });
  if (hasTaskfile) evidence.push({ kind: 'file', path: 'Taskfile.yml', note: `${taskNames.length} tasks` });
  if (hasPkgScripts) evidence.push({ kind: 'file', path: 'package.json', note: `${npmScripts.length} scripts` });
  if (hasPermissionsFile) {
    const permPath = ctx.exists('.claude/settings.json') ? '.claude/settings.json' : '.cursor/rules';
    evidence.push({ kind: 'file', path: permPath, note: 'permissions declaration' });
  }

  return { score, cappedByEvidence: false, evidence, gapIds };
}
