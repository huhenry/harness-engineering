import { parseMarkdown, findSection, bashCommands } from './markdown.mjs';

export const VERIFY_ROLES = ['bootstrap', 'test', 'lint', 'typecheck', 'e2e', 'smoke'];

// Order matters: narrower roles are tested before the catch-all 'test', or a
// command like `npm run test:lint` would be bucketed as the test command and
// the real lint command would be dropped (see the 'lint before test' test).
const CLASSIFIERS = [
  ['bootstrap', /\b(init\.sh|bootstrap|setup\.sh|npm (ci|install)|go mod download|uv sync|poetry install)\b/i],
  ['lint', /\b(lint|ruff|eslint|golangci-lint|clippy|flake8)\b/i],
  ['typecheck', /\b(mypy|tsc|typecheck|type-check)\b/i],
  ['e2e', /\b(e2e|playwright|cypress|integration)\b/i],
  ['smoke', /\b(smoke|healthz|health-check|curl)\b/i],
  ['test', /\b(test|pytest|jest|vitest|go test|cargo test)\b/i],
];

const VERIFY_HEADING = /verif|check|test|验证|检查/i;
const emptyVerify = () => Object.fromEntries(VERIFY_ROLES.map((r) => [r, null]));

// A fenced shell block can contain a `\`-continued command spanning several
// source lines. bashCommands() (Task 5) splits purely on line boundaries, so
// a continuation comes back as two separate strings — the first still ending
// in a trailing backslash. Left alone, that fragment would get classified
// and, later, actually executed on its own by Task 18's verify tool: run by
// itself a dangling `\` makes the shell wait on a continuation that will
// never arrive. Re-join those fragments into one logical command before any
// classification happens.
function joinContinuations(commands) {
  const out = [];
  let pending = null;
  for (const cmd of commands) {
    const merged = pending === null ? cmd : `${pending} ${cmd}`;
    if (merged.endsWith('\\')) {
      pending = merged.slice(0, -1).trimEnd();
    } else {
      out.push(merged);
      pending = null;
    }
  }
  // A dangling continuation with nothing left to join to (backslash on the
  // final line of the block) is still emitted best-effort rather than
  // silently dropped — 'never throw' does not mean 'silently discard'.
  if (pending !== null) out.push(pending);
  return out;
}

// Tries AGENTS.md first, then CLAUDE.md, in that order (fixed, so which file
// wins is deterministic across runs of the same repository).
function fromMarkdown(ctx) {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const raw = ctx.read(file);
    if (raw === null) continue;
    // findSection() returns the first heading (in document order) whose text
    // matches VERIFY_HEADING; if a repo has both '## Testing' and
    // '## Verification', the one that appears earlier in the file wins,
    // deterministically, every time.
    const section = findSection(parseMarkdown(raw), VERIFY_HEADING);
    const commands = joinContinuations(bashCommands(section));
    if (commands.length === 0) continue;
    const verify = emptyVerify();
    for (const cmd of commands) {
      const hit = CLASSIFIERS.find(([role, re]) => verify[role] === null && re.test(cmd));
      if (hit) verify[hit[0]] = cmd;
    }
    return { verify, source: 'agents-md' };
  }
  return null;
}

// Only known roles, and only string commands, survive into the returned
// verify object. This keeps the shape closed to exactly VERIFY_ROLES: an
// unrecognized extra key (e.g. a repo's own "bench" role) is dropped rather
// than passed through, so every downstream consumer that iterates `verify`
// (e.g. Task 12 counting how many check kinds are declared) can trust it
// never sees more than the six known roles. A non-string value (number,
// array, nested object) is dropped to null rather than handed to Task 18,
// which executes these values as shell commands verbatim.
function normalizeVerify(rawVerify) {
  const verify = emptyVerify();
  if (rawVerify && typeof rawVerify === 'object' && !Array.isArray(rawVerify)) {
    for (const role of VERIFY_ROLES) {
      const v = rawVerify[role];
      if (typeof v === 'string' && v.trim() !== '') verify[role] = v;
    }
  }
  return verify;
}

/** Resolve which commands verify should run, and where they came from. */
export function loadConfig(ctx, opts = {}) {
  const path = opts.configPath ?? 'harness.config.json';
  const raw = ctx.readJson(path);
  // JSON.parse can legally produce a non-object top level (an array, string,
  // number, or null) — all "valid JSON" but none of them a valid config
  // shape. Array.isArray guards the case `typeof [] === 'object'` would
  // otherwise let slip through as if it were a real config document.
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      lang: raw.lang === 'zh' ? 'zh' : 'en',
      verify: normalizeVerify(raw.verify),
      ignore: Array.isArray(raw.ignore) ? raw.ignore : [],
      source: 'harness.config.json',
    };
  }
  const md = fromMarkdown(ctx);
  if (md) return { lang: 'en', ignore: [], ...md };
  return { lang: 'en', verify: emptyVerify(), ignore: [], source: 'none' };
}
