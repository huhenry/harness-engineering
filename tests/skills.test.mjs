import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, cpSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DANGEROUS_PATTERNS, checkCommand } from '../scripts/lib/safety.mjs';
import { LEVELS } from '../scripts/lib/level.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['harness-engineering', 'harness-assess', 'harness-scaffold', 'harness-verify', 'harness-loop'];

const read = (name) => readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Every temp directory this file creates, removed when the file's tests
// finish — see ad3ac81 ("stop the test suite littering $TMPDIR with temp
// repositories"): mkdtempSync has no implicit cleanup, so every creation site
// must be routed through a helper with a matching after() hook, the same
// pattern scan.test.mjs / stack.test.mjs / environment.test.mjs already use.
const TEMP_DIRS = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}
after(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md must start with YAML frontmatter');
  return Object.fromEntries(
    m[1].split('\n').filter(Boolean).map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
}

test('all five skills exist and nothing extra is present', () => {
  const dirs = readdirSync(join(ROOT, 'skills')).sort();
  assert.deepEqual(dirs, [...SKILLS].sort());
  for (const s of SKILLS) assert.ok(existsSync(join(ROOT, 'skills', s, 'SKILL.md')), s);
});

test('frontmatter has exactly name and description, and name matches the directory', () => {
  for (const s of SKILLS) {
    const fm = frontmatter(read(s));
    assert.deepEqual(Object.keys(fm).sort(), ['description', 'name'], `${s} frontmatter keys`);
    assert.equal(fm.name, s);
    assert.ok(fm.description.length >= 40, `${s} description too short to trigger reliably`);
    assert.match(fm.description, /^Use when/, `${s} description must state its trigger`);
  }
});

test('every skill documents when to use, when not to, workflow, output reading and hard rules', () => {
  for (const s of SKILLS) {
    const body = read(s);
    for (const heading of ['## When to use', '## When not to use', '## Workflow', '## Reading the output', '## Hard rules']) {
      assert.ok(body.includes(heading), `${s} missing ${heading}`);
    }
  }
});

test('assess skill forbids hand-scoring', () => {
  assert.match(read('harness-assess'), /Never hand-score a repository/);
});

test('scaffold skill forbids overwriting and requires dry-run approval', () => {
  const body = read('harness-scaffold');
  assert.match(body, /Never overwrite an existing file/);
  assert.match(body, /dry-run first/i);
});

test('verify skill forbids evidence-free completion claims and warns about --run', () => {
  const body = read('harness-verify');
  assert.match(body, /Never claim a repository passes without an exit code/);
  assert.match(body, /Only use it on repositories the user trusts/);
});

test('loop skill requires a stop condition and budget cap', () => {
  assert.match(read('harness-loop'), /stop condition and a budget cap/);
});

test('router skill delegates rather than re-implements', () => {
  const body = read('harness-engineering');
  assert.match(body, /Route, do not re-implement/);
  for (const s of SKILLS.slice(1)) assert.ok(body.includes(s), `router must mention ${s}`);
});

test('skill bodies are English-only', () => {
  for (const s of SKILLS) {
    assert.doesNotMatch(read(s), /[一-龥]/, `${s} must not contain Chinese — SKILL.md is prompt context`);
  }
});

// --- Brief B1: the installed-path problem -----------------------------------
//
// Task 22's install.sh (per the plan's own skeleton, confirmed by the
// controller against the plan text before dispatch) copies ONLY skills/ into
// a detected ecosystem directory (`cp -R "$SRC"/skills/. "$t"/`) — it never
// copies scripts/. A skill that tells an agent to run a bare
// `node scripts/verify.mjs <repo>` only ever resolves by accident, in the one
// place that path is guaranteed to exist: a checkout of this very repository.
// Checking `existsSync(join(ROOT, 'scripts/verify.mjs'))` against OUR OWN repo
// root (the plan's own test) proves nothing about the installed context,
// which is exactly the gap the brief calls out.
//
// This test instead simulates the real installed shape: copy skills/ alone
// into a fresh directory with no scripts/ sibling at all (mirroring
// install.sh's actual behavior), then resolve and ACTUALLY RUN every
// `$CLAUDE_PLUGIN_ROOT`-prefixed script command from that detached location,
// with only the CLAUDE_PLUGIN_ROOT env var (which Claude Code sets to a
// plugin's real root directory when it loads an installed plugin skill, per
// the plugin conventions used elsewhere in this ecosystem) making the real
// scripts findable. A skill that hardcoded a bare relative path would fail
// this test with ENOENT/MODULE_NOT_FOUND; one that never mentions a script at
// all (the router) contributes zero matches and trivially passes.
// How Claude Code actually makes ${CLAUDE_PLUGIN_ROOT} work, per its own
// documentation: it performs a TEXT SUBSTITUTION on the skill's markdown when
// loading a plugin skill, replacing the placeholder with the plugin's real
// install directory. It does NOT export an environment variable that a Bash
// subprocess could look up. Two consequences this test exists to pin:
//
//   1. Only the braced `${CLAUDE_PLUGIN_ROOT}` form is documented as being
//      substituted. A bare `$CLAUDE_PLUGIN_ROOT` is not — and because there is
//      no real environment variable behind it, an unsubstituted bare form does
//      not fail loudly: the shell expands the undefined variable to the empty
//      string and runs `node "/scripts/verify.mjs"`, which fails with a
//      confusing ENOENT on a path the user never wrote.
//   2. The command must work with NO such variable present in the environment,
//      because after substitution there is nothing left to look up.
//
// An earlier version of this test set CLAUDE_PLUGIN_ROOT as a real env var and
// spawned the script via a path it had already resolved in JavaScript. That
// passed while every skill used the undocumented bare form, because it never
// exercised substitution or shell expansion at all — green for a reason that
// had nothing to do with how the mechanism works in production.
function substitutePluginRoot(body, pluginRoot) {
  return body.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
}

test('workflow commands resolve and actually execute when the skill is installed away from scripts/', () => {
  const installed = tempDir('harness-skills-install-');
  cpSync(join(ROOT, 'skills'), installed, { recursive: true });
  assert.ok(!existsSync(join(installed, 'scripts')), 'sanity: simulated install must not contain scripts/');

  let sawAnyCommand = false;
  for (const s of SKILLS) {
    const raw = readFileSync(join(installed, s, 'SKILL.md'), 'utf8');

    // Nothing may rely on the undocumented bare form.
    const bare = [...raw.matchAll(/\$CLAUDE_PLUGIN_ROOT(?!\})/g)].filter(
      (m) => raw[m.index - 1] !== '{',
    );
    assert.equal(bare.length, 0, `${s}: uses the undocumented bare $CLAUDE_PLUGIN_ROOT; only \${CLAUDE_PLUGIN_ROOT} is substituted`);

    const body = substitutePluginRoot(raw, ROOT);
    assert.ok(!body.includes('CLAUDE_PLUGIN_ROOT}'), `${s}: a placeholder survived substitution`);

    for (const m of body.matchAll(new RegExp(`node "(${ROOT}/scripts/[a-z-]+\\.mjs)"`, 'g'))) {
      sawAnyCommand = true;
      assert.ok(existsSync(m[1]), `${s}: ${m[1]} does not exist after substitution`);

      // Run the post-substitution command line THROUGH A SHELL, from the
      // detached install dir, with CLAUDE_PLUGIN_ROOT deliberately absent —
      // exactly the situation an installed plugin skill produces.
      const env = { ...process.env };
      delete env.CLAUDE_PLUGIN_ROOT;
      const result = spawnSync('sh', ['-c', `node "${m[1]}" "${join(ROOT, 'fixtures', 'good-repo')}"`], {
        cwd: installed,
        env,
        encoding: 'utf8',
      });
      assert.equal(result.error, undefined, `${s}: ${m[1]} failed to spawn: ${result.error}`);
      assert.notEqual(result.status, null, `${s}: ${m[1]} did not run to completion`);
      assert.ok(result.stdout.includes('#'), `${s}: ${m[1]} produced no real markdown output (stderr: ${result.stderr})`);
    }
  }
  assert.ok(sawAnyCommand, 'no ${CLAUDE_PLUGIN_ROOT} script command was found in any skill — the test would pass vacuously');
});

test('no skill relies on a bare "node scripts/..." path as its only way to find the tools', () => {
  // A bare relative form is allowed as a documented FALLBACK for people
  // working inside a checkout of this repo (see each skill's "Locate the
  // scripts" step) — what must never happen is a skill offering ONLY that
  // form, since that is precisely the form that breaks post-install.
  for (const s of SKILLS) {
    const body = read(s);
    const bareMatches = [...body.matchAll(/\bnode scripts\/[a-z-]+\.mjs\b/g)];
    if (bareMatches.length === 0) continue;
    assert.match(body, /CLAUDE_PLUGIN_ROOT/, `${s} shows a bare scripts/ path but never mentions CLAUDE_PLUGIN_ROOT as the primary form`);
  }
});

// --- Brief B2: --allow cannot override the four hard rules -------------------
test('harness-verify names every current hard rule from safety.mjs and says --allow cannot override them', () => {
  const hardIds = DANGEROUS_PATTERNS.filter((p) => p.hard).map((p) => p.id).sort();
  // Sanity pin: if safety.mjs's hard-rule set ever changes, this fails loudly
  // instead of the skill silently going stale next to the real code.
  assert.deepEqual(hardIds, ['destructive-rm', 'disk-write', 'find-delete', 'sudo']);

  const body = read('harness-verify');
  for (const id of hardIds) {
    assert.ok(body.includes(id), `harness-verify must name hard rule '${id}'`);
  }
  assert.match(body, /can never override the four hard rules/i);

  // Cross-check against real checkCommand behavior, not just prose: an
  // --allow pattern that matches everything must still leave every hard rule
  // blocked, and must let a merely soft-flagged command (deploy-words) through.
  assert.equal(checkCommand('rm -rf /', [/.*/]).blocked, true);
  assert.equal(checkCommand('sudo apt install x', [/.*/]).blocked, true);
  assert.equal(checkCommand('dd if=/dev/zero of=/dev/sda', [/.*/]).blocked, true);
  assert.equal(checkCommand('find / -delete', [/.*/]).blocked, true);
  assert.equal(checkCommand('make deploy', [/.*/]).blocked, false);
});

// --- Brief B3: deploy-words is word-boundary matched, and includes "production" ---
test("harness-verify's deploy-words description matches the real word-boundary regex, including 'production'", () => {
  const deployWords = DANGEROUS_PATTERNS.find((p) => p.id === 'deploy-words');
  assert.equal(deployWords.re.source, '\\b(deploy|prod|production|release)\\b');

  const body = read('harness-verify');
  assert.match(body, /\bproduction\b/, 'harness-verify must mention "production", not just deploy/prod/release');
  assert.match(body, /word/i, 'harness-verify must describe this as word-boundary matching, not substring matching');

  // The skill's own worked examples must be literally true against the real
  // regex — if the regex ever moves, this breaks instead of the SKILL.md
  // quietly telling the model something false.
  for (const [cmd, blocked] of [
    ['prod-check', true],
    ['releases/list', false],
    ['deployment.yaml', false],
    ['npm run deploy', true],
  ]) {
    assert.ok(body.includes(cmd), `harness-verify should show the worked example '${cmd}'`);
    assert.equal(checkCommand(cmd).blocked, blocked, `sanity: checkCommand('${cmd}').blocked should be ${blocked}`);
  }
});

// --- Brief C: the Task 16 LIMITATIONS statement must survive, verbatim -------
//
// Read from a literal copied into THIS test file, not from
// .superpowers/sdd/**, which is gitignored (task-21-limitations-en.md would
// not exist in a fresh clone or in CI) — the test must not depend on a
// planning artifact that is never shipped.
const LIMITATIONS_CORE_SENTENCE = 'Treat a clean result from this module as "no known accidental or '
  + 'unsophisticated-adversarial pattern was found" — not as "this command is safe to run unattended."';

const LIMITATIONS_FULL_TEXT = `
This module is a safety net against accidents and obvious hazards, not a sandbox against a
determined adversary. It statically matches a command string with regexes and lightweight token
scans; it never runs a real shell parser, and it cannot know what a command actually does once
the shell itself expands variables, substitutes command output, or otherwise resolves indirection
at runtime.

Seven rounds of adversarial review closed a real, growing list of gaps — tool/subcommand
adjacency, separators and whitespace hidden inside quotes, a normalization pass's own performance
blowup, line continuations, argument-order permutation, path-prefixed binaries, and shell
indirection at both the payload and the binary-name level. Each fix measurably shrank the space
of commands this module gets wrong. But the underlying approach has a hard ceiling: anything this
module's logic has not specifically been taught to recognize will get through, because there is
no bound on how a shell command can be constructed to defeat a fixed set of checks. Two gaps are
left deliberately, not because they were missed: ANSI-C quoting (\`$'r'$'m'\` reconstructs \`rm\` one
escaped character at a time, with no substring any pattern here ever sees as "rm"), and shell
expansion used anywhere beyond the single binary-position check this module now performs (a value
assembled across several variable assignments and combined only at the last moment, for
instance).

Treat a clean result from this module as "no known accidental or unsophisticated-adversarial
pattern was found" — not as "this command is safe to run unattended." The actual safety boundary
is the combination of this blocklist plus \`--allow\`: the blocklist catches what a human might not
think to check for, and \`--allow\` is where informed human judgment is supposed to enter. If a
command comes from a source you don't trust, a green result here is not a substitute for reading
it yourself.
`;

test('harness-verify carries the Task 16 LIMITATIONS statement, verbatim, including its core sentence', () => {
  const body = read('harness-verify');
  assert.ok(norm(body).includes(norm(LIMITATIONS_CORE_SENTENCE)), 'core sentence missing or reworded');
  assert.ok(norm(body).includes(norm(LIMITATIONS_FULL_TEXT)), 'full LIMITATIONS statement missing or reworded');
});

// --- Brief D: blocked/planned both mean "never executed" ---------------------
test("harness-verify's status table never describes blocked or planned as having run", () => {
  const body = read('harness-verify');
  const tableSection = body.slice(body.indexOf('## Reading the output'));
  assert.match(tableSection, /`planned`[^\n]*\|[^\n]*No/, 'planned row must say it did not execute');
  assert.match(tableSection, /`blocked`[^\n]*\|[^\n]*No/, 'blocked row must say it did not execute');
  assert.match(tableSection, /`passed`[^\n]*\|[^\n]*Yes/);
  assert.match(tableSection, /`failed`[^\n]*\|[^\n]*Yes/);
  assert.match(tableSection, /`timeout`[^\n]*\|[^\n]*Yes/);
  // The exact phrase this project's own history warns against re-introducing
  // (task-18: "not executed" != "failed").
  assert.match(body, /never read (a |as an )?`?blocked`?[^.]*as a failure|not read as a failure/i);
});

// --- Brief D: harness-assess must state the Feedback-capped-at-2 / no-L4-without-evidence claim, cross-checked against level.mjs ---
test('harness-assess states that L4 is unreachable without verify evidence, matching level.mjs', () => {
  const l4 = LEVELS.find((l) => l.id === 4);
  assert.ok(l4, 'level.mjs must define L4');
  const feedbackCondition = l4.conditions.find((c) => c.label.includes('feedback'));
  const evidenceCondition = l4.conditions.find((c) => c.label.includes('evidence'));
  assert.ok(feedbackCondition, 'L4 must gate on a feedback score');
  assert.ok(evidenceCondition, 'L4 must gate on verify evidence');
  // Executable proof, not just reading the label text: feedback=3 alone,
  // with no evidence, must NOT satisfy L4's evidence condition.
  assert.equal(evidenceCondition.test({ feedback: 3 }, false), false);
  assert.equal(evidenceCondition.test({ feedback: 3 }, true), true);

  const body = read('harness-assess');
  assert.match(body, /L4/);
  assert.match(body, /Feedback[^.]*(cannot|can never|can't|no more than|at most) exceed 2|Feedback[^.]*capped at 2/i);
  assert.match(body, /unreachable/i);
});
