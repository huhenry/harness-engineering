import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GAPS, SUBSYSTEMS } from '../scripts/lib/rubric.mjs';
import { LEVELS } from '../scripts/lib/level.mjs';
import { DEFAULT_PROFILE, SUPPORTED_PROFILES } from '../scripts/lib/profiles.mjs';
import { DANGEROUS_PATTERNS, checkCommand } from '../scripts/lib/safety.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const DOCS = ['README.md', 'README.zh-CN.md', 'ROADMAP.md', 'ROADMAP.zh-CN.md',
  'CONTRIBUTING.md', 'references/rubric.md', 'references/rubric.zh-CN.md',
  'references/failure-modes.md', 'references/failure-modes.zh-CN.md'];

test('all documentation files exist', () => {
  for (const d of DOCS) assert.ok(existsSync(join(ROOT, d)), `missing ${d}`);
});

test('both READMEs carry every required section', () => {
  const required = {
    'README.md': ['## Why', '## Install', '## Quick start', '## The six subsystems', '## Levels', '## Safety', '## Credits', '## License'],
    'README.zh-CN.md': ['## 为什么', '## 安装', '## 快速开始', '## 六个子系统', '## 等级', '## 安全', '## 致谢', '## 许可'],
  };
  for (const [file, headings] of Object.entries(required)) {
    const body = read(file);
    for (const h of headings) assert.ok(body.includes(h), `${file} missing ${h}`);
  }
});

test('READMEs link to each other', () => {
  assert.match(read('README.md'), /README\.zh-CN\.md/);
  assert.match(read('README.zh-CN.md'), /README\.md/);
});

test('READMEs warn that verify --run executes repository commands', () => {
  assert.match(read('README.md'), /executes[\s\S]{0,80}commands/i);
  assert.match(read('README.zh-CN.md'), /会执行/);
});

test('READMEs credit the upstream course', () => {
  for (const f of ['README.md', 'README.zh-CN.md']) {
    assert.match(read(f), /walkinglabs\.github\.io\/learn-harness-engineering/);
  }
});

test('rubric docs list every gap id defined in code', () => {
  for (const f of ['references/rubric.md', 'references/rubric.zh-CN.md']) {
    const body = read(f);
    for (const g of GAPS) assert.ok(body.includes(g.id), `${f} missing gap ${g.id}`);
  }
});

test('rubric docs list every subsystem and level', () => {
  for (const f of ['references/rubric.md', 'references/rubric.zh-CN.md']) {
    const body = read(f);
    for (const s of SUBSYSTEMS) assert.ok(body.includes(s), `${f} missing subsystem ${s}`);
    for (const l of LEVELS) assert.ok(body.includes(`L${l.id}`), `${f} missing L${l.id}`);
  }
});

test('profile documentation matches the implementation contract', () => {
  assert.equal(DEFAULT_PROFILE, 'repository');
  assert.deepEqual(SUPPORTED_PROFILES, ['repository', 'harness-distribution']);
  for (const file of [
    'README.md', 'README.zh-CN.md',
    'references/rubric.md', 'references/rubric.zh-CN.md',
  ]) {
    const body = read(file);
    for (const profile of SUPPORTED_PROFILES) {
      assert.ok(body.includes(profile), `${file} missing profile ${profile}`);
    }
    assert.ok(body.includes('**/skills/**/SKILL.md'), `${file} missing skill discovery shape`);
    assert.ok(body.includes('**/agents/*.md'), `${file} missing agent discovery shape`);
    assert.ok(body.includes('**/workflows/*'), `${file} missing workflow discovery shape`);
    assert.ok(body.includes('.github/workflows'), `${file} missing GitHub workflow exclusion`);
    assert.match(body, /diff/i, `${file} missing cross-profile diff boundary`);
  }
  assert.match(read('README.md'), /cannot change[^.]{0,100}(subsystem score|score)/i);
  assert.match(read('README.zh-CN.md'), /不能改变[^。]{0,100}(子系统分数|总分)/);
  for (const file of ['ROADMAP.md', 'ROADMAP.zh-CN.md']) {
    assert.match(read(file), /v1\.3/);
    assert.match(read(file), /harness-distribution/);
  }
});

test('no documentation file contains TODO or TBD', () => {
  for (const d of DOCS) assert.doesNotMatch(read(d), /\b(TODO|TBD)\b/, d);
});

test('README shows the harness level badge', () => {
  assert.match(read('README.md'), /!\[Harness Level\]/);
});

// --- Brief B1: the plan's badge address (.harness/badge.json) is permanently
// gitignored by Task 18's `.harness/.gitignore` (content `*`, written on
// every `verify --run`), so raw.githubusercontent.com can never see it and
// the badge would be permanently broken. Measured directly (see the task-23
// report): `node scripts/verify.mjs <repo> --run` leaves
// `<repo>/.harness/.gitignore` containing exactly `*`. The chosen fix here
// is a different, actually-committable path: `harness-badge.json` at the
// repo root. This must stay consistent with whatever Task 24 (which
// generates the badge JSON) writes to.
test('README points the badge at a path that is not gitignored, not at the broken .harness/ location', () => {
  const en = read('README.md');
  assert.doesNotMatch(en, /\.harness\/badge\.json/, 'README must not use the plan\'s broken .harness/badge.json address (see brief B1)');
  assert.match(en, /harness-badge\.json/, 'README must point the badge at harness-badge.json');

  // Prove the chosen path is not excluded by any .gitignore in this repo —
  // git check-ignore exits 1 (and prints nothing) when a path is NOT
  // ignored, 0 when it IS ignored. A future change to root .gitignore (or
  // to .harness/.gitignore) that starts swallowing this path must turn this
  // test red immediately, not leave the badge silently 404ing again.
  let ignored;
  try {
    execFileSync('git', ['check-ignore', '--quiet', 'harness-badge.json'], { cwd: ROOT });
    ignored = true; // exit 0: git DOES ignore this path
  } catch (err) {
    if (err.status !== 1) throw err; // anything other than "not ignored" is a real failure
    ignored = false;
  }
  assert.equal(ignored, false, 'harness-badge.json must not be gitignored anywhere in this repo');
});

// --- Brief B2: the plan's own `## Safety` prose has the same two defects
// Task 21 already had to correct in SKILL.md: (1) deploy-words is a
// word-boundary match, not "anything matching", and it includes
// "production"; (2) --allow can never override the four *hard* rules
// (sudo, destructive-rm, find-delete, disk-write) — it can only override a
// *soft* rule. Cross-checked here against the real DANGEROUS_PATTERNS data,
// not just prose, the same way tests/skills.test.mjs already does for
// harness-verify/SKILL.md, so a future change to safety.mjs's rule set
// fails this test loudly instead of the README quietly going stale.
test('README Safety section matches safety.mjs: word-boundary deploy-words (incl. "production"), and --allow cannot override the four hard rules', () => {
  const deployWords = DANGEROUS_PATTERNS.find((p) => p.id === 'deploy-words');
  assert.equal(deployWords.re.source, '\\b(deploy|prod|production|release)\\b');

  const hardIds = DANGEROUS_PATTERNS.filter((p) => p.hard).map((p) => p.id).sort();
  assert.deepEqual(hardIds, ['destructive-rm', 'disk-write', 'find-delete', 'sudo']);

  const en = read('README.md');
  assert.match(en, /\bword\b/i, 'README must describe deploy-words as word-boundary matching, not substring matching');
  assert.match(en, /\bproduction\b/, 'README must mention "production", which the plan\'s prose omitted');
  for (const id of hardIds) {
    assert.ok(en.includes(id), `README.md must name hard rule '${id}'`);
  }
  assert.doesNotMatch(en, /anything matching/i, 'README must not repeat the plan\'s "anything matching" overstatement');

  // The README's own worked examples must be literally true against the
  // real regex, and a broad --allow must still leave every hard rule
  // blocked while letting a soft rule through.
  for (const [cmd, blocked] of [
    ['prod-check', true],
    ['releases/list', false],
    ['deployment.yaml', false],
  ]) {
    assert.ok(en.includes(cmd), `README.md should show the worked example '${cmd}'`);
    assert.equal(checkCommand(cmd).blocked, blocked, `sanity: checkCommand('${cmd}').blocked should be ${blocked}`);
  }
  assert.equal(checkCommand('rm -rf /', [/.*/]).blocked, true);
  assert.equal(checkCommand('sudo apt install x', [/.*/]).blocked, true);
  assert.equal(checkCommand('dd if=/dev/zero of=/dev/sda', [/.*/]).blocked, true);
  assert.equal(checkCommand('find / -delete', [/.*/]).blocked, true);
  assert.equal(checkCommand('make deploy', [/.*/]).blocked, false);
});

// --- Brief B3: install.sh only ships skill text, never scripts/, and none
// of its target directories (including the default .claude/skills) get a
// $CLAUDE_PLUGIN_ROOT-equivalent variable — confirmed by actually running
// install.sh into a temp dir (see the task-23 report) and reading its own
// printed NOTE. The two install paths are not interchangeable and the
// README must say so plainly, not present them as two equally-working
// options.
test('README Install section states install.sh ships skill text only and the two paths are not equivalent', () => {
  for (const f of ['README.md', 'README.zh-CN.md']) {
    assert.match(read(f), /install\.sh/);
  }
  const en = read('README.md');
  assert.match(en, /not equivalent/i, 'README must say the plugin and install.sh paths are not equivalent');
  assert.match(en, /does not copy `?scripts\/?`?|never copies `?scripts\/?`?/i, 'README must state install.sh does not copy scripts/');
  assert.match(en, /CLAUDE_PLUGIN_ROOT/, 'README must explain why install.sh needs one more step (no $CLAUDE_PLUGIN_ROOT-equivalent)');

  const zh = read('README.zh-CN.md');
  assert.match(zh, /不等价/, 'README.zh-CN.md must say the two paths are not equivalent');
  assert.match(zh, /scripts\//, 'README.zh-CN.md must mention that install.sh does not copy scripts/');
});

// Fix round 2, Finding 4: five shipped docs restated GAPS.length as a
// hardcoded "37" instead of deriving it, and every one of them silently
// went stale the moment fix round 1 (Finding 3) added state.handoff-unfilled
// -- the true count moved to 38 without any of these five noticing. Derive
// the number from GAPS.length here (never hardcode it a second time) so a
// future gap addition or removal fails this test loudly instead of leaving
// five documents quietly wrong again. \s+ tolerates the count and the word
// "gap"/"ids" landing on either side of a markdown line-wrap, since two of
// these five (references/failure-modes.md and its zh-CN counterpart) wrap
// exactly there in the source text.
test('every doc that states the gap-id count matches GAPS.length', () => {
  const n = GAPS.length;
  const targets = [
    { file: 'README.md', re: new RegExp(`\\b${n}\\s+gap\\s+ids\\b`) },
    { file: 'README.zh-CN.md', re: new RegExp(`${n}\\s+个\\s+gap\\s+id\\b`) },
    { file: 'references/failure-modes.md', re: new RegExp(`\\b${n}\\s+gap\\s+ids\\b`) },
    { file: 'references/failure-modes.zh-CN.md', re: new RegExp(`${n}\\s+个\\s+gap\\s+id\\b`) },
    { file: 'AGENTS.md', re: new RegExp(`${n}-gap-id\\b`) },
  ];
  for (const { file, re } of targets) {
    assert.match(read(file), re, `${file} does not state the current gap-id count (${n})`);
  }
});
