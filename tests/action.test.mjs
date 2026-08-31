import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SUPPORTED_LANGS } from '../scripts/lib/i18n.mjs';
import { computeDiff } from '../scripts/lib/diff.mjs';
import {
  COMMENT_MARKER, renderComment, findExistingComment, shouldFail,
  inputEnvName, readInputs, baseExportError,
} from '../scripts/action.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('action metadata uses the current Node 24 JavaScript-action runtime', () => {
  const yml = readFileSync(join(ROOT, 'action.yml'), 'utf8');
  assert.match(yml, /using:\s*['"]node24['"]/);
  assert.doesNotMatch(yml, /using:\s*['"]node20['"]/, 'the retired Node 20 action runtime must not return');
});

test('the self-hosting workflow consumes every declared Action output', () => {
  const action = readFileSync(join(ROOT, 'action.yml'), 'utf8');
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'harness-diff.yml'), 'utf8');
  const block = action.slice(action.indexOf('\noutputs:'), action.indexOf('\nruns:'));
  const outputs = [...block.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(outputs, [
    'level-after', 'level-before', 'regression', 'score-after', 'score-before', 'score-delta',
  ]);
  assert.match(workflow, /name: Harness score delta\n        id: harness\n/);
  for (const name of outputs) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      workflow,
      new RegExp(`steps\\.harness\\.outputs\\[['"]${escaped}['"]\\]`),
      `workflow never consumes the '${name}' output`,
    );
  }
});

/**
 * A minimal report shaped like `assess --json`'s real output, mirroring the
 * helper tests/diff.test.mjs already uses. Gap ids must be REAL rubric ids:
 * the comment renderer looks every gap's title up through `gapById`, exactly
 * as scripts/diff.mjs does, so an invented id would throw rather than render
 * -- which is the behaviour we want, and the reason this helper does not
 * make up its own.
 */
function report({ total = 12, level = 2, subsystems = {}, gaps = {} } = {}) {
  const ids = ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop'];
  return {
    schemaVersion: 1,
    score: { total, max: 24 },
    level: { id: level, name: `L${level}`, unmetGates: [] },
    subsystems: ids.map((id) => ({
      id,
      score: subsystems[id] ?? 2,
      max: 4,
      cappedByEvidence: false,
      evidence: [],
      gaps: (gaps[id] ?? []).map((g) => ({
        id: g.id, severity: g.severity ?? 'high', title: 'T', why: 'W', fix: 'F',
        scaffoldable: false, roi: 1, suppressedBy: null,
      })),
    })),
  };
}

const IMPROVED = computeDiff(report({ total: 12, level: 2 }), report({ total: 18, level: 3 }));
const REGRESSED = computeDiff(report({ total: 18, level: 3 }), report({ total: 12, level: 2 }));
const UNCHANGED = computeDiff(report(), report());

// --- the marker -------------------------------------------------------

// The whole update-in-place strategy rests on this: a marker that survives
// a round trip through GitHub's markdown renderer without being visible to
// a human reader. An HTML comment is the only thing that does both.
test('the marker is a hidden HTML comment and is the comment body\'s first line', () => {
  assert.match(COMMENT_MARKER, /^<!--.*-->$/);
  for (const lang of SUPPORTED_LANGS) {
    const [first] = renderComment(IMPROVED, lang).split('\n');
    assert.equal(first, COMMENT_MARKER, `${lang} comment must open with the marker`);
  }
});

// --- the three verdicts ----------------------------------------------

// Asserted against literal wording, not against `t()` with the same key --
// re-deriving the expected string from the same table the renderer reads
// would pass no matter what the table said, which is the exact tautology
// this milestone has already had to fix once. If someone rewords these
// strings into something that no longer communicates a regression, this
// test is what has to notice.
test('a regression does not read like good news, in either language', () => {
  const en = renderComment(REGRESSED, 'en');
  assert.match(en, /regressed/i);
  assert.doesNotMatch(en, /improved/i, 'a regression comment must not claim an improvement');
  assert.match(en, /-6/, 'the regression comment must carry the signed delta');

  const zh = renderComment(REGRESSED, 'zh');
  assert.match(zh, /回归/);
  assert.doesNotMatch(zh, /提升/, '回归的评论不能读起来像好消息');
});

test('an improvement reads as an improvement, in either language', () => {
  const en = renderComment(IMPROVED, 'en');
  assert.match(en, /improved/i);
  assert.doesNotMatch(en, /regressed/i);
  assert.match(en, /\+6/);

  const zh = renderComment(IMPROVED, 'zh');
  assert.match(zh, /提升/);
  assert.doesNotMatch(zh, /回归/);
});

// "Nothing changed" is a real, useful answer -- a reviewer needs to be able
// to tell it apart from "the action did not run". An empty or heading-only
// body cannot do that, so the no-change body must still carry the actual
// numbers and the per-subsystem table.
test('an unchanged score still produces a body with the real numbers in it', () => {
  for (const lang of SUPPORTED_LANGS) {
    const body = renderComment(UNCHANGED, lang);
    assert.ok(body.length > 200, `${lang} body is suspiciously short: ${body.length} chars`);
    assert.match(body, /12\/24|12 \/ 24|12/, `${lang} body must state the score`);
    assert.match(body, /\| --- \| --- \| --- \|/, `${lang} body must include the subsystem table`);
  }
  assert.match(renderComment(UNCHANGED, 'en'), /unchanged/i);
  assert.match(renderComment(UNCHANGED, 'zh'), /没有改变/);
});

test('both languages render, differ from each other, and agree on every number', () => {
  const en = renderComment(REGRESSED, 'en');
  const zh = renderComment(REGRESSED, 'zh');
  assert.notEqual(en, zh, 'the two languages must actually differ');
  const numbers = (s) => s.match(/-?\d+/g).join(' ');
  assert.equal(numbers(en), numbers(zh), 'the two languages must state identical numbers in identical order');
});

test('the comment names the gaps a change fixed and introduced', () => {
  const before = report({ gaps: { state: [{ id: 'state.no-progress' }] } });
  const after = report({ gaps: { instructions: [{ id: 'instructions.missing' }] } });
  const body = renderComment(computeDiff(before, after), 'en');
  assert.match(body, /No progress file/);
  assert.match(body, /No AGENTS\.md or CLAUDE\.md/);
});

// --- the gate ---------------------------------------------------------

test('shouldFail only fails when fail-on-regression is on AND there is a regression', () => {
  assert.equal(shouldFail(REGRESSED, false), false, 'the default must never fail someone else\'s CI');
  assert.equal(shouldFail(REGRESSED, true), true, 'an opted-in regression must fail');
  assert.equal(shouldFail(IMPROVED, true), false, 'an improvement must never fail');
  assert.equal(shouldFail(UNCHANGED, true), false, 'no change must never fail');
  assert.equal(shouldFail(IMPROVED, false), false);
});

// --- finding our own comment -----------------------------------------

test('findExistingComment picks out only the comment carrying the marker', () => {
  const comments = [
    { id: 1, body: 'LGTM' },
    { id: 2, body: `${COMMENT_MARKER}\nold body` },
    { id: 3, body: 'thanks!' },
  ];
  assert.equal(findExistingComment(comments), 2);
});

test('findExistingComment returns null when nobody has posted ours yet', () => {
  assert.equal(findExistingComment([{ id: 1, body: 'LGTM' }]), null);
  assert.equal(findExistingComment([]), null);
});

// A reviewer quoting our comment back (GitHub's "Quote reply" copies the
// body verbatim, HTML comment and all) must not make us start editing their
// message instead of ours. The marker only counts on the first line, which
// is the only place we ever write it.
test('findExistingComment ignores a comment that merely quotes the marker further down', () => {
  const comments = [{ id: 7, body: `as you can see above:\n${COMMENT_MARKER}\nold body` }];
  assert.equal(findExistingComment(comments), null);
});

test('findExistingComment returns the oldest match, so repeated runs keep editing one comment', () => {
  const comments = [
    { id: 11, body: `${COMMENT_MARKER}\na` },
    { id: 22, body: `${COMMENT_MARKER}\nb` },
  ];
  assert.equal(findExistingComment(comments), 11);
});

test('findExistingComment survives a malformed API response instead of throwing', () => {
  assert.equal(findExistingComment(null), null);
  assert.equal(findExistingComment([{ id: 1 }, { id: 2, body: null }]), null);
});

// --- inputs -----------------------------------------------------------

// The one hard-coded assertion of GitHub's actual convention. Everything
// else in this file goes through `inputEnvName`, so this single test is
// what pins the transformation to reality.
//
// The runner uppercases the input name and replaces SPACES with `_` -- and
// nothing else. Hyphens survive verbatim, which is why `repo-path` arrives
// as `INPUT_REPO-PATH` and not `INPUT_REPO_PATH`. Established from
// actions/runner's Handler.cs (`$"INPUT_{pair.Key?.Replace(' ', '_')
// .ToUpperInvariant()}"`), corroborated by @actions/core's getInput
// (`name.replace(/ /g, '_').toUpperCase()`) reading the same name back, and
// by GitHub's own metadata-syntax documentation, whose worked example is
// literally `INPUT_NUM-OCTOCATS`. Getting this backwards would leave every
// hyphenated input silently reading as its default -- the action would run,
// report a number, and quietly ignore everything the user configured.
test('an input name becomes INPUT_<UPPERCASE>, with spaces -- and only spaces -- turned into _', () => {
  assert.equal(inputEnvName('repo-path'), 'INPUT_REPO-PATH');
  assert.equal(inputEnvName('fail-on-regression'), 'INPUT_FAIL-ON-REGRESSION');
  assert.equal(inputEnvName('lang'), 'INPUT_LANG');
  assert.equal(inputEnvName('some name'), 'INPUT_SOME_NAME');
});

// Every input this action declares must be one `inputEnvName` away from
// action.yml, with no third spelling anywhere. Reading action.yml as the
// source of truth is what keeps the two from drifting: an input added to
// the metadata but never read (or renamed on one side only) fails here
// rather than becoming a silently ignored knob.
test('every input declared in action.yml is one the action actually reads', () => {
  const yml = readFileSync(join(ROOT, 'action.yml'), 'utf8');
  const block = yml.slice(yml.indexOf('\ninputs:'), yml.indexOf('\noutputs:'));
  const declared = [...block.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(declared, ['base-ref', 'comment', 'fail-on-regression', 'lang', 'repo-path']);

  // Set every declared input to a recognizable value through the real
  // name-mangling, and require all five to come back out of readInputs.
  const env = {};
  for (const name of declared) env[inputEnvName(name)] = name === 'lang' ? 'zh' : name === 'comment' || name === 'fail-on-regression' ? 'true' : `set-${name}`;
  const i = readInputs(env);
  assert.deepEqual(i, {
    repoPath: 'set-repo-path', baseRef: 'set-base-ref',
    failOnRegression: true, comment: true, lang: 'zh',
  });
});

test('readInputs applies action.yml\'s defaults when the runner passes nothing', () => {
  const i = readInputs({});
  assert.equal(i.repoPath, '.');
  assert.equal(i.baseRef, '');
  assert.equal(i.failOnRegression, false);
  assert.equal(i.comment, true);
  assert.equal(i.lang, 'en');
});

test('readInputs reads the values the runner actually sets', () => {
  const i = readInputs({
    [inputEnvName('repo-path')]: 'sub/dir',
    [inputEnvName('base-ref')]: 'abc123',
    [inputEnvName('fail-on-regression')]: 'true',
    [inputEnvName('comment')]: 'false',
    [inputEnvName('lang')]: 'zh',
  });
  assert.equal(i.repoPath, 'sub/dir');
  assert.equal(i.baseRef, 'abc123');
  assert.equal(i.failOnRegression, true);
  assert.equal(i.comment, false);
  assert.equal(i.lang, 'zh');
});

// An empty string is what the runner sets for an input whose default is an
// unresolvable expression -- `${{ github.event.pull_request.base.sha }}` on
// a workflow_dispatch run, for instance. It must fall back to the declared
// default, not be taken literally as "the empty repo path".
test('readInputs treats an empty value as absent and falls back to the default', () => {
  const i = readInputs({
    [inputEnvName('repo-path')]: '',
    [inputEnvName('lang')]: '',
    [inputEnvName('comment')]: '',
  });
  assert.equal(i.repoPath, '.');
  assert.equal(i.lang, 'en');
  assert.equal(i.comment, true);
});

test('readInputs trims surrounding whitespace, as the runner\'s own getInput does', () => {
  assert.equal(readInputs({ [inputEnvName('base-ref')]: '  abc123\n' }).baseRef, 'abc123');
});

// Silently reading `fail-on-regression: yes` as false would leave someone
// believing they are gated when they are not -- a tool reporting something
// untrue about itself, which is the one thing this project exists to
// prevent. Refuse instead.
test('readInputs refuses a boolean input that is neither true nor false', () => {
  assert.throws(
    () => readInputs({ [inputEnvName('fail-on-regression')]: 'yes' }),
    /fail-on-regression/,
  );
  assert.throws(() => readInputs({ [inputEnvName('comment')]: '1' }), /comment/);
});

test('readInputs accepts the YAML spellings of true and false', () => {
  for (const yes of ['true', 'True', 'TRUE']) {
    assert.equal(readInputs({ [inputEnvName('fail-on-regression')]: yes }).failOnRegression, true);
  }
  for (const no of ['false', 'False', 'FALSE']) {
    assert.equal(readInputs({ [inputEnvName('comment')]: no }).comment, false);
  }
});

test('readInputs refuses a language this tool does not have a table for', () => {
  assert.throws(() => readInputs({ [inputEnvName('lang')]: 'fr' }), /Unsupported language/);
});

// --- the shallow-checkout trap ---------------------------------------

// GitHub's default checkout depth is 1, so the base commit is simply not in
// .git and `git archive` fails. A generic git error here sends every
// first-time user to file an issue; the message has to name the fix.
test('the base-export failure message names fetch-depth: 0', () => {
  const msg = baseExportError('deadbeef', 128, "fatal: not a valid object name: deadbeef");
  assert.match(msg, /fetch-depth: 0/);
  assert.match(msg, /deadbeef/, 'the message must name the ref it could not resolve');
  assert.match(msg, /actions\/checkout@v7/);
  assert.doesNotMatch(msg, /actions\/checkout@v4/, 'the remediation must not revive the retired example');
});

test('a base-ref that is not in .git stops the action with the fetch-depth advice', () => {
  const r = spawnSync('node', [join(ROOT, 'scripts', 'action.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      [inputEnvName('repo-path')]: '.',
      // A syntactically valid sha that is certainly not an object in this
      // repository -- exactly what a shallow checkout leaves behind.
      [inputEnvName('base-ref')]: '0000000000000000000000000000000000000001',
      [inputEnvName('comment')]: 'false',
      [inputEnvName('fail-on-regression')]: 'false',
      [inputEnvName('lang')]: 'en',
      GITHUB_TOKEN: '',
    },
  });
  assert.notEqual(r.status, 0, 'the action must not pretend it compared anything');
  assert.match(r.stderr, /fetch-depth: 0/);
});
