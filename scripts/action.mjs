#!/usr/bin/env node
/**
 * The GitHub Action entry point: assess the head, assess the base, and put
 * the difference on the pull request.
 *
 * Zero dependencies, like everything else here. No `@actions/core`, no
 * `@actions/github`, no bundler: inputs come from the `INPUT_*` environment
 * variables the runner sets, HTTP goes through Node 20's built-in `fetch`,
 * and step outputs/summaries are written with the documented file-command
 * protocol. The runner executes this committed file directly, so what is
 * reviewed in this repository is exactly what runs.
 *
 * Everything that renders or decides is a pure exported function; every
 * effect (git, the filesystem, the network, the exit code) lives in
 * `main()`. That split is what lets tests/action.test.mjs cover the parts
 * that matter without ever opening a socket.
 */
import { mkdtempSync, rmSync, mkdirSync, readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from './lib/cli.mjs';
import { t, assertLang } from './lib/i18n.mjs';
import { computeDiff } from './lib/diff.mjs';
import { renderDiffMarkdown, fmtDelta } from './diff.mjs';
import { runAssess } from './assess.mjs';

/**
 * The first line of every comment this action writes, and the only thing
 * that tells a later run "this one is mine, edit it".
 *
 * An HTML comment because it has to survive GitHub's markdown renderer
 * while staying invisible to a human reader; a fixed literal because the
 * whole point is that a run six months from now recognizes a comment this
 * run wrote. Changing it orphans every comment already posted, which would
 * then never be updated again.
 */
export const COMMENT_MARKER = '<!-- harness-engineering-diff -->';

// --- inputs -----------------------------------------------------------

/**
 * The environment variable the runner sets for an `action.yml` input.
 *
 * Uppercase, and SPACES -- only spaces -- become underscores. A hyphen
 * survives verbatim, so the input `repo-path` arrives as `INPUT_REPO-PATH`,
 * not `INPUT_REPO_PATH`. This is not a guess: actions/runner builds the name
 * as `$"INPUT_{pair.Key?.Replace(' ', '_').ToUpperInvariant()}"`
 * (Runner.Worker/Handlers/Handler.cs), @actions/core reads it back as
 * `process.env[\`INPUT_${name.replace(/ /g, '_').toUpperCase()}\`]`
 * (packages/core/src/core.ts), and GitHub's own metadata-syntax
 * documentation spells the worked example out as `INPUT_NUM-OCTOCATS`.
 *
 * Guessing underscores here would have failed silently in the worst
 * possible way: every hyphenated input would read as empty, fall back to
 * its default, and the action would run to completion reporting a number
 * while quietly ignoring everything the user configured. Note that a name
 * containing a hyphen is not a valid POSIX shell identifier, so reproducing
 * a run locally needs `env 'INPUT_REPO-PATH=.' node …` rather than a bare
 * `INPUT_REPO-PATH=. node …`, which every shell rejects.
 */
export function inputEnvName(name) {
  return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

/**
 * Read one input, trimmed, treating absent and empty as the same thing.
 *
 * The runner materializes `action.yml` defaults into the environment before
 * this process starts, so in CI an omitted input already arrives with its
 * declared default. It still arrives EMPTY, though, whenever the default is
 * an expression that did not resolve -- `${{ github.event.pull_request
 * .base.sha }}` on any event that is not a pull request -- and it is absent
 * entirely when this file is run outside Actions. Both cases have to land on
 * the same branch, which is why callers pass their own fallback rather than
 * relying on the runner. Trimming matches `core.getInput`, which trims by
 * default.
 */
function rawInput(env, name, fallback) {
  const value = env[inputEnvName(name)];
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * The six spellings `core.getBooleanInput` accepts, from the YAML 1.2 core
 * schema -- and nothing else.
 *
 * Anything else is refused rather than coerced. Reading
 * `fail-on-regression: yes` as `false` would leave someone believing their
 * pipeline is gated when it is not: the tool would be reporting something
 * untrue about itself, which is the single failure mode this project exists
 * to prevent. A loud usage error costs one red run and one obvious fix.
 */
function booleanInput(env, name, fallback) {
  const raw = rawInput(env, name, null);
  if (raw === null) return fallback;
  if (['true', 'True', 'TRUE'].includes(raw)) return true;
  if (['false', 'False', 'FALSE'].includes(raw)) return false;
  throw new CliError(
    `Invalid value for the '${name}' input: '${raw}'. `
    + 'Expected one of: true | True | TRUE | false | False | FALSE '
    + '(the YAML 1.2 core schema booleans, the same set @actions/core accepts).',
  );
}

/** Every input, resolved and validated, in one object. Pure: the whole
 * environment is a parameter, so tests construct one instead of mutating
 * `process.env` and racing each other. */
export function readInputs(env) {
  return {
    repoPath: rawInput(env, 'repo-path', '.'),
    baseRef: rawInput(env, 'base-ref', ''),
    failOnRegression: booleanInput(env, 'fail-on-regression', false),
    comment: booleanInput(env, 'comment', true),
    lang: assertLang(rawInput(env, 'lang', 'en')),
  };
}

// --- rendering --------------------------------------------------------

/**
 * Which of the three things happened, as a sentence a reviewer can act on.
 *
 * `computeDiff` guarantees that a non-regression has every subsystem delta
 * `>= 0`, so once `regression` is ruled out the total alone separates
 * "better" from "no movement" -- there is no fourth case to write a branch
 * for. A regression is stated first and stated plainly; a comment that
 * buried it under a table of numbers would be a comment nobody reads in
 * time.
 */
function verdict(result, lang) {
  const common = {
    before: result.before.total, after: result.after.total,
    max: result.after.max, level: result.after.level,
    delta: fmtDelta(result.delta.total),
  };
  if (result.regression) {
    return t('action.verdict.regressed', lang, { ...common, reasons: result.regressionReasons.join(', ') });
  }
  if (result.delta.total > 0) return t('action.verdict.improved', lang, common);
  return t('action.verdict.unchanged', lang, common);
}

/**
 * The full pull request comment body.
 *
 * Pure, and deliberately thin: the marker, a verdict callout, the exact
 * markdown `diff.mjs` prints for the same DiffResult, and a footer
 * explaining why this comment keeps changing instead of multiplying. The
 * body is NOT re-rendered here from the DiffResult -- reusing
 * renderDiffMarkdown is what keeps a pull request comment and a local
 * `node scripts/diff.mjs` run from ever disagreeing about the same numbers.
 */
export function renderComment(result, lang) {
  return [
    COMMENT_MARKER,
    `> ${verdict(result, lang)}`,
    '',
    renderDiffMarkdown(result, lang),
    `<sub>${t('action.footer', lang)}</sub>`,
    '',
  ].join('\n');
}

// --- finding the comment we already posted ----------------------------

/**
 * The id of the comment this action posted previously, or null.
 *
 * Only the FIRST line counts. GitHub's "Quote reply" copies a comment body
 * verbatim, HTML comment and all, so a reviewer quoting our comment back
 * would otherwise make the next run edit their message instead of ours.
 * Returning the oldest match (rather than the newest) is what makes
 * repeated pushes converge on one comment: whichever comment a run picks,
 * every later run picks the same one.
 *
 * Tolerant of a malformed response on purpose -- this feeds a code path
 * that must never be the reason a build fails.
 */
export function findExistingComment(comments) {
  if (!Array.isArray(comments)) return null;
  for (const c of comments) {
    if (typeof c?.body !== 'string') continue;
    if (c.body.split('\n', 1)[0].trim() === COMMENT_MARKER) return c.id;
  }
  return null;
}

// --- the gate ---------------------------------------------------------

/**
 * Whether this step should fail.
 *
 * Both conditions, always: an opted-in gate AND a real regression. The
 * default is off because a check that goes red on the day it is installed
 * gets uninstalled rather than investigated -- the first thing anyone does
 * with a new signal is find out what it says about their repository, and
 * they cannot do that if it is blocking their merge queue while they read
 * it. Nothing else about the run can fail the step: a failed comment, a
 * missing token, an unreachable API are all reported and stepped over.
 */
export function shouldFail(result, failOnRegression) {
  return failOnRegression === true && result.regression === true;
}

// --- the base side ----------------------------------------------------

/**
 * The message for a base ref `git archive` could not resolve.
 *
 * Almost always one specific cause, so it says so: actions/checkout fetches
 * with depth 1 by default, which does not bring the base commit into `.git`
 * at all. A bare "fatal: not a valid object name" here would send every
 * first-time user to open an issue instead of adding one line to their
 * workflow, so the remedy is spelled out literally rather than described.
 */
export function baseExportError(baseRef, status, stderr) {
  return [
    `Could not export base ref '${baseRef}' (git archive exited ${status}).`,
    '',
    'The usual cause is a shallow checkout. actions/checkout defaults to',
    'fetch-depth: 1, which fetches only the commit under test -- the base',
    'commit is not in .git at all, so there is nothing to compare against.',
    'Set fetch-depth: 0 on the checkout step that feeds this action:',
    '',
    '    - uses: actions/checkout@v4',
    '      with:',
    '        fetch-depth: 0',
    '',
    `git said: ${String(stderr).trim() || '(no output)'}`,
  ].join('\n');
}

/** Where the repository root is, and where `repoPath` sits inside it.
 * Assessing a subdirectory has to compare the SAME subdirectory on both
 * sides, and `git archive` always exports from the root, so the prefix is
 * what lines the two up. */
function locateInRepo(repoPath) {
  const r = spawnSync('git', ['-C', repoPath, 'rev-parse', '--show-toplevel', '--show-prefix'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new CliError(
      `'${repoPath}' is not inside a git repository, so there is no base commit to compare against `
      + `(git exited ${r.status}: ${String(r.stderr ?? r.error?.message).trim()}).`,
    );
  }
  const [toplevel, prefix = ''] = r.stdout.split('\n');
  return { toplevel, prefix };
}

/**
 * Materialize `baseRef` into `destDir` without touching the repository.
 *
 * `git archive` is a pure read: it streams a commit's tree out, and unlike a
 * second `actions/checkout` or a `git worktree add` it writes nothing into
 * the workspace and nothing into `.git/`. That is the whole reason it was
 * chosen -- this project promises `assess` is read-only and that the Action
 * does not write the repository it is assessing, and a base checkout that
 * quietly clobbered the working tree would break both.
 *
 * Via `--output=` and a temp file rather than a pipe: spawnSync's stdout is
 * capped by maxBuffer, and any repository worth assessing produces a tar
 * larger than the default. A shell pipeline would avoid that but would put
 * `baseRef` -- an attacker-influenceable action input -- through `sh -c`.
 * Neither git nor tar is invoked through a shell here.
 */
function exportBase(toplevel, baseRef, workDir) {
  const tarPath = join(workDir, 'base.tar');
  const destDir = join(workDir, 'base');
  mkdirSync(destDir, { recursive: true });

  const archive = spawnSync('git', ['-C', toplevel, 'archive', '--format=tar', `--output=${tarPath}`, baseRef], { encoding: 'utf8' });
  if (archive.error || archive.status !== 0) {
    throw new CliError(baseExportError(baseRef, archive.status, archive.stderr ?? archive.error?.message ?? ''));
  }
  const untar = spawnSync('tar', ['-xf', tarPath, '-C', destDir], { encoding: 'utf8' });
  if (untar.error || untar.status !== 0) {
    throw new Error(`Could not unpack the base export (tar exited ${untar.status}): ${String(untar.stderr ?? untar.error?.message).trim()}`);
  }
  return destDir;
}

// --- runner plumbing --------------------------------------------------

/** Escape a workflow-command payload. Raw newlines would end the command
 * early and print the rest as ordinary log text. */
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** A warning annotation. Visible in the job's UI, and -- this is the point
 * -- does not affect the step's exit status. */
const warn = (message) => process.stdout.write(`::warning::${escapeData(message)}\n`);

/** Append to one of the runner's file-command files, if the runner set it.
 * Absent outside Actions, which is exactly when we want to do nothing. */
function appendFileCommand(env, varName, text) {
  const path = env[varName];
  if (!path) return;
  try {
    appendFileSync(path, text, { encoding: 'utf8' });
  } catch (err) {
    warn(`Could not write ${varName}: ${err.message}`);
  }
}

/** Step outputs, in the documented heredoc form. The delimiter is a fresh
 * UUID per value because a value that happened to contain the delimiter on
 * a line of its own would otherwise truncate or corrupt the file -- the
 * same defence @actions/core uses. */
function setOutputs(env, outputs) {
  for (const [name, value] of Object.entries(outputs)) {
    const d = `ghadelimiter_${randomUUID()}`;
    appendFileCommand(env, 'GITHUB_OUTPUT', `${name}<<${d}\n${value}\n${d}\n`);
  }
}

// --- the comment ------------------------------------------------------

/** Where to post, and with what. `GITHUB_API_URL` rather than a hardcoded
 * api.github.com so this works on GitHub Enterprise Server too. */
function commentContext(env) {
  let number = null;
  if (env.GITHUB_EVENT_PATH) {
    try {
      number = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))?.pull_request?.number ?? null;
    } catch { number = null; }
  }
  return {
    api: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    repo: env.GITHUB_REPOSITORY || '',
    token: env.GITHUB_TOKEN || '',
    number,
  };
}

/**
 * One authenticated call.
 *
 * The token travels in a header and never in the URL, so nothing here can
 * leak it into a log line -- error messages quote the method, the URL and a
 * bounded slice of the response body, never a request header.
 */
async function gh(url, { method = 'GET', token, payload } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'harness-engineering',
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    const err = new Error(`${method} ${url} -> HTTP ${res.status} ${res.statusText}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Post the comment, or edit the one already there.
 *
 * Paginated because a busy pull request can easily hold more than a page of
 * comments, and missing ours on page two would mean posting a second one --
 * which is the failure this whole marker mechanism exists to avoid. Capped
 * so a pathological thread cannot turn one action run into a hundred API
 * calls; if the cap is reached without a match we post, accepting a
 * duplicate over an unbounded scan.
 */
async function syncComment(ctx, body) {
  const issues = `${ctx.api}/repos/${ctx.repo}/issues`;
  let existing = null;
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`${issues}/${ctx.number}/comments?per_page=100&page=${page}`, { token: ctx.token });
    if (!Array.isArray(batch) || batch.length === 0) break;
    existing = findExistingComment(batch);
    if (existing !== null || batch.length < 100) break;
  }
  if (existing !== null) {
    await gh(`${issues}/comments/${existing}`, { method: 'PATCH', token: ctx.token, payload: { body } });
    return `Updated the existing harness comment (id ${existing}).`;
  }
  await gh(`${issues}/${ctx.number}/comments`, { method: 'POST', token: ctx.token, payload: { body } });
  return 'Posted a new harness comment.';
}

/**
 * Everything about commenting, with every failure downgraded to a warning.
 *
 * Nothing in here may fail the step. A pull request from a fork gets a
 * read-only `GITHUB_TOKEN` and will always get 403 on the write; a repo
 * with `pull-requests: write` withheld will too; the API can simply be
 * down. None of those says anything about the repository being assessed,
 * and a tool that reddens someone's CI for its own inability to post a
 * comment is a tool they remove. The diff has already been written to the
 * log and the job summary by the time this runs, so the information is not
 * lost either way.
 */
async function tryComment(ctx, body) {
  if (!ctx.token) {
    warn('No GITHUB_TOKEN in the environment, so no comment was posted. Pass it explicitly: env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }.');
    return;
  }
  if (!ctx.repo || ctx.number === null) {
    warn('No pull request in this event payload, so there is nothing to comment on. The diff is in the job summary.');
    return;
  }
  try {
    process.stdout.write(`${await syncComment(ctx, body)}\n`);
  } catch (err) {
    const forkHint = err.status === 403
      ? ' A pull request opened from a fork gets a read-only GITHUB_TOKEN, so this is expected there '
        + '— the diff is in the job summary instead. Otherwise, check that the job grants '
        + 'permissions: { pull-requests: write }.'
      : '';
    warn(`Could not post the harness comment: ${err.message}${forkHint}`);
  }
}

// --- main -------------------------------------------------------------

async function main(env) {
  const inputs = readInputs(env);
  if (inputs.baseRef === '') {
    throw new CliError(
      "The 'base-ref' input is empty. It defaults to the pull request's base sha, which only exists "
      + 'on a pull_request event — set base-ref explicitly when running this action on any other event.',
    );
  }

  const repoPath = isAbsolute(inputs.repoPath) ? inputs.repoPath : resolve(process.cwd(), inputs.repoPath);
  const { toplevel, prefix } = locateInRepo(repoPath);

  // One clock for both sides. runAssess takes `now` as a parameter
  // precisely so a caller can guarantee that -- two `new Date()` calls
  // could straddle the 24h evidence-freshness boundary and make the two
  // reports disagree for a reason that has nothing to do with the diff.
  const now = new Date();
  const head = runAssess({ repoPath, lang: inputs.lang, now });

  const workDir = mkdtempSync(join(tmpdir(), 'harness-action-'));
  try {
    const baseRoot = exportBase(toplevel, inputs.baseRef, workDir);
    const base = runAssess({ repoPath: prefix ? join(baseRoot, prefix) : baseRoot, lang: inputs.lang, now });

    // `git archive` exports tracked files only, so the base side can never
    // contain `.harness/verify-report.json` (this tool's own verify output
    // is gitignored by design). If a previous step in the same job produced
    // that evidence in the workspace, the head side has it and the base
    // side structurally cannot — and Feedback/Environment would show an
    // improvement nobody made. Say so rather than let the number stand.
    if (head.evidence.verified !== base.evidence.verified) {
      warn(
        'Only one side of this comparison has verify evidence '
        + `(head: ${head.evidence.verified}, base: ${base.evidence.verified}), because \`git archive\` `
        + 'exports tracked files only and .harness/verify-report.json is never tracked. '
        + 'Part of the movement below is that asymmetry, not a change to the repository — '
        + 'run this action before any `verify --run` step to compare like with like.',
      );
    }

    const result = computeDiff(base, head);
    const body = renderComment(result, inputs.lang);

    process.stdout.write(`${body}\n`);
    appendFileCommand(env, 'GITHUB_STEP_SUMMARY', `${body}\n`);
    setOutputs(env, {
      'score-before': result.before.total,
      'score-after': result.after.total,
      'score-delta': fmtDelta(result.delta.total),
      'level-before': result.before.level,
      'level-after': result.after.level,
      regression: String(result.regression),
    });

    if (inputs.comment) await tryComment(commentContext(env), body);

    return shouldFail(result, inputs.failOnRegression) ? 1 : 0;
  } finally {
    // The only thing this action ever wrote, and it lived outside the
    // repository the whole time.
    rmSync(workDir, { recursive: true, force: true });
  }
}

// Identical to assess.mjs's and diff.mjs's guard, and for the same reason:
// process.argv[1] is unresolved while import.meta.url has been resolved
// through symlinks, so both sides have to be normalized before they can be
// compared. See the long note in scripts/diff.mjs.
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.env).then(
    (code) => { process.exitCode = code; },
    (err) => {
      // Same three-way split every entry point in this repository uses: 2 is
      // "you configured me wrong" (a bad input value, a base ref that isn't
      // in .git), 3 is "the tool broke". 1 is reserved for the one outcome
      // that is a successful run reporting a real result — an opted-in
      // regression — and is returned from main(), never thrown.
      process.stderr.write(`${err instanceof CliError ? err.message : (err.stack ?? err.message)}\n`);
      process.exitCode = err instanceof CliError ? err.exitCode : 3;
    },
  );
}
