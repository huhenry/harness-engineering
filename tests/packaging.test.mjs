import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, cpSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const SKILLS = ['harness-engineering', 'harness-assess', 'harness-scaffold', 'harness-verify', 'harness-loop'];

// Same tempRepo()+after() convention as tests/scan.test.mjs and
// tests/skills.test.mjs (see ad3ac81) -- every mkdtempSync call is routed
// through this helper so nothing is left behind in $TMPDIR.
const TEMP_DIRS = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}
after(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

// --- plugin.json ------------------------------------------------------------
//
// Fields verified against Claude Code's official plugin manifest docs
// (https://code.claude.com/docs/en/plugins-reference, fetched directly) --
// see task-22-report.md's B2 section for the field-by-field citations. Not
// copied blind from the plan: `author` really is an object (`name` required,
// `email`/`url` optional), `repository` really is a plain string (source URL,
// not a `{type,url}` object), and `.claude-plugin/plugin.json` with a
// sibling top-level `skills/` (never nested inside `.claude-plugin/`) really
// is the required layout.
test('plugin.json carries the required metadata', () => {
  const p = readJson('.claude-plugin/plugin.json');
  assert.equal(p.name, 'harness-engineering');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.equal(p.license, 'MIT');
  assert.equal(p.repository, 'https://github.com/huhenry/harness-engineering');
  assert.ok(p.description.length > 30);
  assert.ok(Array.isArray(p.keywords) && p.keywords.includes('harness'));
  // `author` must be an object per the official schema (name required,
  // email/url optional) -- not a bare string, which the plan never actually
  // pinned down (see brief B2).
  assert.equal(typeof p.author, 'object');
  assert.equal(p.author.name, 'huhenry');
  assert.match(p.author.url, /^https:\/\//);
});

// --- marketplace.json --------------------------------------------------------
//
// `owner` shape and the `source` field's relative-path form ("must start
// with `./`, resolved relative to the marketplace root") are both taken
// directly from the same official docs page's Marketplace Schema section,
// cross-checked against a real published marketplace.json
// (ivan-magda/claude-code-plugin-template) that uses the identical
// `./plugins/<name>` relative-path idiom. `source: "./"` for a plugin that
// lives at the marketplace root itself (this repo's actual layout) is the
// degenerate case of that same documented rule; see the report for exactly
// what is and is not independently confirmed for that literal form.
test('marketplace.json points at this plugin', () => {
  const m = readJson('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'harness-engineering');
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].source, './');
  assert.match(m.plugins[0].source, /^\.\//, 'relative plugin sources must start with "./" per the official schema');
  assert.equal(m.plugins[0].version, readJson('.claude-plugin/plugin.json').version);
  assert.equal(typeof m.owner, 'object');
  assert.equal(m.owner.name, 'huhenry');
});

test('plugin version is the single source of truth for package.json', () => {
  assert.equal(readJson('package.json').version, readJson('.claude-plugin/plugin.json').version);
});

// --- install.sh: the multi-ecosystem copy path -------------------------------

test('install.sh copies every skill into a detected ecosystem directory', () => {
  const dst = tempDir('harness-install-');
  mkdirSync(join(dst, '.cursor', 'skills'), { recursive: true });
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  for (const s of SKILLS) {
    assert.ok(existsSync(join(dst, '.cursor', 'skills', s, 'SKILL.md')), `missing ${s}`);
  }
});

test('install.sh copies into every detected ecosystem directory, not just the first one', () => {
  const dst = tempDir('harness-install-multi-');
  mkdirSync(join(dst, '.cursor', 'skills'), { recursive: true });
  mkdirSync(join(dst, '.codex', 'skills'), { recursive: true });
  // .gemini/skills and .agent/skills deliberately absent -- must not appear.
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  for (const eco of ['.cursor', '.codex']) {
    for (const s of SKILLS) {
      assert.ok(existsSync(join(dst, eco, 'skills', s, 'SKILL.md')), `missing ${eco}/skills/${s}`);
    }
  }
  assert.ok(!existsSync(join(dst, '.gemini')), 'must not create an ecosystem dir that was never present');
  assert.ok(!existsSync(join(dst, '.agent')), 'must not create an ecosystem dir that was never present');
});

test('install.sh --dry-run writes nothing', () => {
  const dst = tempDir('harness-install-dry-');
  mkdirSync(join(dst, '.cursor', 'skills'), { recursive: true });
  execFileSync('sh', [join(ROOT, 'install.sh'), '--dry-run'], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  assert.deepEqual(readdirSync(join(dst, '.cursor', 'skills')), []);
});

test('install.sh defaults to .claude/skills when nothing is detected', () => {
  const dst = tempDir('harness-install-default-');
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  assert.ok(existsSync(join(dst, '.claude', 'skills', 'harness-engineering', 'SKILL.md')));
});

test('install.sh is executable', () => {
  const mode = statSync(join(ROOT, 'install.sh')).mode;
  assert.ok(mode & 0o111, 'install.sh must carry the executable bit (chmod +x)');
});

test('install.sh is valid POSIX sh under dash, not just bash-flavored /bin/sh', (t) => {
  const dashPath = ['/bin/dash', '/usr/bin/dash'].find((p) => existsSync(p));
  if (!dashPath) { t.skip('dash not installed on this machine'); return; }
  const dst = tempDir('harness-install-dash-');
  const result = spawnSync(dashPath, [join(ROOT, 'install.sh')], {
    cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, `dash run failed: ${result.stderr}`);
  assert.ok(existsSync(join(dst, '.claude', 'skills', 'harness-engineering', 'SKILL.md')));
});

// --- Brief B3.1: cp -R overwrite semantics -----------------------------------
//
// Judgment call (see report): re-running install.sh over an existing
// harness-* skill directory overwrites it -- treated as an upgrade, not data
// loss, because these directories are entirely this project's own generated
// content (never a place a user is expected to hand-edit and keep local
// changes to). This test pins that real, current behavior down as a
// regression test rather than leaving it as an unverified claim in prose.
test('install.sh overwrites an existing skill install on re-run (upgrade semantics)', () => {
  const dst = tempDir('harness-install-upgrade-');
  const target = join(dst, '.cursor', 'skills');
  mkdirSync(target, { recursive: true });
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });

  const skillFile = join(target, 'harness-verify', 'SKILL.md');
  const shipped = readFileSync(skillFile, 'utf8');
  const tampered = `${shipped}\n<!-- locally edited by a user -->\n`;
  writeFileSync(skillFile, tampered);
  assert.equal(readFileSync(skillFile, 'utf8'), tampered, 'sanity: local edit landed before reinstall');

  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  assert.equal(readFileSync(skillFile, 'utf8'), shipped, 'reinstall must overwrite back to the shipped copy');
});

// --- Brief B1 (Critical): the installed-path decision, proven, not asserted -
//
// Decision: (b) -- install.sh's five ecosystem targets ship skill TEXT only,
// same as the plan's own skeleton, and this is disclosed rather than hidden.
// See task-22-report.md for the full reasoning; the short version: every
// wrapping SKILL.md (harness-assess/scaffold/verify, all Task 21 content
// this task must not touch) already documents a three-way script-location
// check whose third branch says, verbatim, "this skill was installed by
// copying only skills/ into another ecosystem ... Ask the user for a
// harness-engineering checkout path ... Do not guess a path." That prose
// already IS option (b), already ships, and already has its own passing
// test (tests/skills.test.mjs). Option (a) would require rewriting that
// prose in three files this task is barred from touching, and no
// $CLAUDE_PLUGIN_ROOT-equivalent env var exists in the four other
// ecosystems for a relative-path scheme to anchor on -- see the report.
//
// What must still be proven for real, not just asserted, is the OTHER half
// of the dual-distribution promise: that the Claude Code plugin path this
// task's own .claude-plugin/ manifests newly enable actually works,
// end-to-end, from a fully detached install -- not merely from a repo
// checkout where every path resolves by construction. This copies
// .claude-plugin/, skills/, and scripts/ together into one temp directory
// (mirroring what Claude Code's own docs describe: "Claude Code copies each
// installed plugin into the local versioned plugin cache"), points
// the plugin bundle, performs the SAME TEXT SUBSTITUTION Claude Code performs
// on a plugin skill's markdown, and spawns the resulting command line through
// a shell from a THIRD, unrelated directory -- so nothing about the result can
// be explained by accidental proximity to this repository's own scripts/.
//
// Substitution, not an environment variable: per Claude Code's documentation
// the `${CLAUDE_PLUGIN_ROOT}` placeholder is replaced inside the skill's own
// markdown when the skill loads; no such variable is exported to a Bash
// subprocess. So this test deliberately runs with CLAUDE_PLUGIN_ROOT ABSENT
// from the environment -- after substitution there is nothing left to look up,
// and a command that still needed the variable would be broken in production.
test('B1: a fully detached plugin install actually runs a documented command end to end', () => {
  const installed = tempDir('harness-plugin-install-');
  for (const dir of ['.claude-plugin', 'skills', 'scripts']) {
    cpSync(join(ROOT, dir), join(installed, dir), { recursive: true });
  }
  assert.ok(existsSync(join(installed, '.claude-plugin', 'plugin.json')), 'sanity: this looks like a real plugin bundle');

  const skillBody = readFileSync(join(installed, 'skills', 'harness-assess', 'SKILL.md'), 'utf8')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', installed);
  const m = skillBody.match(new RegExp(`node "(${installed}/scripts/[a-z-]+\\.mjs)"`));
  assert.ok(m, 'harness-assess must document a ${CLAUDE_PLUGIN_ROOT} script command');

  const unrelatedCwd = tempDir('harness-plugin-cwd-');
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  const result = spawnSync('sh', ['-c', `node "${m[1]}" "${join(ROOT, 'fixtures', 'good-repo')}"`], {
    cwd: unrelatedCwd,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, `failed to spawn: ${result.error}`);
  assert.notEqual(result.status, null, 'process did not run to completion');
  assert.ok(result.stdout.includes('#'), `expected real markdown report on stdout (stderr: ${result.stderr})`);
});

// --- Brief B1(b): the honest-limitation half of the same decision -----------
//
// The flip side of the plugin path working: install.sh's targets must NOT
// pretend to work. No scripts/ may be resolvable from an install.sh-produced
// skill directory at any of the relative offsets a script-relative-path
// scheme could plausibly try, and install.sh's own stdout must say so in
// its own words -- not leave the user to discover the gap by trying a
// command and getting ENOENT.
test('install.sh targets ship skill text only -- no scripts/ is resolvable, and install.sh says so', () => {
  const dst = tempDir('harness-install-limitation-');
  mkdirSync(join(dst, '.codex', 'skills'), { recursive: true });
  const output = execFileSync('sh', [join(ROOT, 'install.sh')], {
    cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT }, encoding: 'utf8',
  });

  const skillDir = join(dst, '.codex', 'skills', 'harness-verify');
  assert.ok(existsSync(join(skillDir, 'SKILL.md')));
  // Every relative offset a "walk up from the skill's own directory" scheme
  // could plausibly try -- none of them resolve, because install.sh never
  // copies scripts/ anywhere.
  assert.ok(!existsSync(join(skillDir, 'scripts')), 'no scripts/ next to the skill itself');
  assert.ok(!existsSync(join(dst, '.codex', 'skills', 'scripts')), 'no scripts/ as a sibling of the skill directories');
  assert.ok(!existsSync(join(dst, '.codex', 'scripts')), 'no scripts/ one level up');
  assert.ok(!existsSync(join(dst, 'scripts')), 'no scripts/ at the install target root');

  assert.match(output, /script/i, 'install.sh output must mention the scripts/ gap in its own words');
  assert.match(output, /(checkout|github\.com\/huhenry\/harness-engineering)/i, 'install.sh output must point at where to get a working checkout');
});

// install.sh copies skill TEXT only, and none of the five target
// ecosystems set a $CLAUDE_PLUGIN_ROOT-equivalent variable — so the skills'
// documented `node "${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs"` commands could not
// resolve after a plain install, and the skill had to ask the user for a
// checkout path the first time it needed one. install.sh already knows its
// own source path; it now substitutes it.
test('install.sh substitutes the checkout path into installed skill text', () => {
  const dst = tempDir('harness-install-subst-');
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  for (const skill of SKILLS) {
    const text = readFileSync(join(dst, '.claude', 'skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(
      !text.includes('${CLAUDE_PLUGIN_ROOT}'),
      `${skill}/SKILL.md still carries an unsubstituted \${CLAUDE_PLUGIN_ROOT}`,
    );
  }
});

// The substitution is a blanket `sed ... g`, so it rewrites the skill's own
// explanation of the placeholder just as readily as it rewrites a command.
// A shipped version of these skills said "it only works in the braced
// ${CLAUDE_PLUGIN_ROOT} form", and a real install turned that into "it only
// works in the braced /Users/.../harness-engineering form" -- a sentence
// that is simply false, in the file whose whole job is telling an agent how
// to find the scripts. The existing tests only checked that the placeholder
// was gone, which that damaged text passes.
//
// The rule that makes the blanket substitution safe is positional: the
// placeholder may appear only immediately before `/scripts/`. This asserts
// it on the INSTALLED output, where the damage would actually show up
// (tests/skills.test.mjs asserts the same rule on the source).
test('installing never rewrites prose -- the substituted path lands only in script paths', () => {
  const dst = tempDir('harness-install-prose-');
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  for (const skill of SKILLS) {
    const text = readFileSync(join(dst, '.claude', 'skills', skill, 'SKILL.md'), 'utf8');
    let from = 0;
    for (;;) {
      const at = text.indexOf(ROOT, from);
      if (at === -1) break;
      assert.equal(
        text.slice(at + ROOT.length, at + ROOT.length + 9), '/scripts/',
        `${skill}/SKILL.md: the substituted checkout path at offset ${at} is not part of a scripts/ path -- `
        + `sed rewrote prose. Context: ${JSON.stringify(text.slice(Math.max(0, at - 60), at + ROOT.length + 40))}`,
      );
      from = at + ROOT.length;
    }
  }
});

// Task 4 made an install.sh install resolve its own commands. The installed
// skill's decision procedure has to say so: the version shipped before this
// test still told the agent that an install.sh install has "no scripts
// present at all. Ask the user for the path" -- a live instruction to do
// the exact thing the substitution abolished.
test('the installed skill does not tell the agent to ask for a path it already has', () => {
  const dst = tempDir('harness-install-branch-');
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  for (const skill of ['harness-assess', 'harness-scaffold', 'harness-verify']) {
    const text = readFileSync(join(dst, '.claude', 'skills', skill, 'SKILL.md'), 'utf8');
    const askBullet = text.split('\n').find((l) => l.includes('Ask the user'));
    assert.ok(askBullet, `${skill}/SKILL.md must still document the ask-the-user fallback`);
    assert.ok(
      !/install\.sh` into|installed by copying only/.test(askBullet),
      `${skill}/SKILL.md still files an install.sh install under "ask the user for a path": ${askBullet}`,
    );
    assert.match(
      text, /`install\.sh`[^\n]*install time/,
      `${skill}/SKILL.md must say that an install.sh install writes the path in at install time`,
    );
  }
});

test('the substituted command actually runs', () => {
  const dst = tempDir('harness-install-runs-');
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  const text = readFileSync(join(dst, '.claude', 'skills', 'harness-assess', 'SKILL.md'), 'utf8');
  // Pull the first `node "<path>/scripts/assess.mjs"` occurrence back out of
  // the installed text and run it for real — the whole point of this fix is
  // that the path in the installed skill resolves, and only executing it
  // proves that.
  const m = text.match(/node "([^"]*\/scripts\/assess\.mjs)"/);
  assert.ok(m, 'installed harness-assess SKILL.md must contain a runnable assess command');
  // assess.mjs legitimately exits 1 whenever a repo has any high-severity gap
  // and no --min-level is given (its own documented exit-code contract), and
  // fixtures/bad-repo -- a deliberate 0/24 fixture -- has several. execFileSync
  // throws on a non-zero exit by default, so asserting on its return value
  // would fail here regardless of whether the path substitution works.
  // spawnSync plus an explicit status check runs the identical command
  // without that false failure, and also pins down the real, correct exit
  // code as part of proving the command runs.
  const result = spawnSync('node', [m[1], join(ROOT, 'fixtures', 'bad-repo'), '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1, `assess.mjs should exit 1 for bad-repo's high-severity gaps (stderr: ${result.stderr})`);
  assert.equal(JSON.parse(result.stdout).level.id, 0);
});

test('the source checkout is not mutated by installing', () => {
  const before = readFileSync(join(ROOT, 'skills', 'harness-assess', 'SKILL.md'), 'utf8');
  const dst = tempDir('harness-install-nomutate-');
  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });
  const after = readFileSync(join(ROOT, 'skills', 'harness-assess', 'SKILL.md'), 'utf8');
  assert.equal(after, before, 'install.sh must never rewrite its own source skills/');
  assert.ok(before.includes('${CLAUDE_PLUGIN_ROOT}'), 'the source keeps the placeholder form');
});

test('a checkout path containing shell-special characters survives substitution', () => {
  // sed's replacement text treats &, |, and \ specially -- & means "the whole
  // match", \ is the escape character, and | is the delimiter install.sh's
  // sed command uses. All three must be escaped once, up front, or a real
  // path containing any of them would corrupt the substitution or break the
  // sed command's own syntax. Cover all three characters install.sh's own
  // escape class ([&|\\]) claims to handle, not just '&' -- a fix round 1
  // review found this test only exercised '&', leaving '|' and '\' untested
  // (not a live bug -- hand-verified to round-trip correctly -- but the gap
  // itself was real).
  const weird = tempDir('harness-src-a&b|c\\d-');
  cpSync(join(ROOT, 'skills'), join(weird, 'skills'), { recursive: true });
  cpSync(join(ROOT, 'install.sh'), join(weird, 'install.sh'));
  const dst = tempDir('harness-install-weird-');
  execFileSync('sh', [join(weird, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: weird } });
  const text = readFileSync(join(dst, '.claude', 'skills', 'harness-assess', 'SKILL.md'), 'utf8');
  assert.ok(text.includes(`${weird}/scripts/assess.mjs`), 'the literal path must land intact');
});

// Fix round 1 finding 1 (Important, bordering Critical): install.sh's
// substitution loop used to glob "$t"/*/SKILL.md at the DESTINATION, which
// matches every SKILL.md in the target directory -- not just the five this
// script just copied. ${CLAUDE_PLUGIN_ROOT} is a general Claude Code
// convention, not proprietary to this repo, so any third-party skill already
// installed alongside harness-engineering's own (e.g. sharing .claude/skills)
// got silently rewritten too, pointing its commands at a path inside THIS
// checkout that has nothing to do with it. This project leads with the
// guarantee that it never overwrites a file it did not ship; an installer
// that silently corrupts an unrelated stranger's file breaks that promise
// outright. The fix scopes the substitution to exactly the skill directory
// names enumerated from "$SRC"/skills/, never a destination glob.
test('install.sh never touches a foreign skill\'s SKILL.md sharing the same target directory', () => {
  const dst = tempDir('harness-install-foreign-');
  const foreignDir = join(dst, '.claude', 'skills', 'some-other-tool');
  mkdirSync(foreignDir, { recursive: true });
  const foreignPath = join(foreignDir, 'SKILL.md');
  const foreignBefore = '---\nname: some-other-tool\n---\n\nRun: node "${CLAUDE_PLUGIN_ROOT}/their/tool.mjs"\n';
  writeFileSync(foreignPath, foreignBefore);

  execFileSync('sh', [join(ROOT, 'install.sh')], { cwd: dst, env: { ...process.env, HARNESS_SRC: ROOT } });

  const foreignAfter = readFileSync(foreignPath, 'utf8');
  assert.equal(foreignAfter, foreignBefore, 'install.sh must never rewrite a SKILL.md it did not ship, byte-identical or not at all');

  // Sanity: the five shipped skills still got their real substitution in the
  // same run, proving this isn't passing by accident (e.g. the loop silently
  // doing nothing at all).
  for (const skill of SKILLS) {
    const text = readFileSync(join(dst, '.claude', 'skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT}'), `${skill}/SKILL.md should still be substituted`);
  }
});
