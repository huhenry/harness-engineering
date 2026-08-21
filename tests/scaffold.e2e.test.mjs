import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, cpSync, existsSync, readFileSync, writeFileSync, statSync, rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScaffold, stamp, assertWhitelisted } from '../scripts/scaffold.mjs';
import { TEMPLATE_WHITELIST, readTemplate } from '../scripts/lib/templates.mjs';
import { runVerify } from '../scripts/verify.mjs';
import { runAssess } from '../scripts/assess.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-08-10T12:00:00Z');

// Additional plan defect found beyond brief section B (see task-20-
// report.md's "additional defects" section): the raw plan's own Step-1
// `copyFixture` (task-20-brief-raw.md) takes no TestContext and never
// cleans up the directory it creates -- every one of its 9 given tests
// leaks a temp directory forever. This is inconsistent with this project's
// own established convention (verify.e2e.test.mjs's `tempDir`/`t.after`)
// and directly violates this task's own workflow instruction ("跑完确认
// 没有留下临时目录"). Measured before this fix: repeated development runs
// of this file alone left 200+ `harness-scaffold-*` directories under
// tmpdir(). Fixed here by threading node:test's `t` (TestContext) through
// -- purely additive (registers cleanup; does not change any assertion or
// expectation any of the plan's 9 given tests make), so every test below
// takes `t` as its second argument even where the plan's own listing shows
// a zero-arg `() => {}`.
function copyFixture(t, name) {
  const dst = mkdtempSync(join(tmpdir(), `harness-scaffold-${name}-`));
  t.after(() => rmSync(dst, { recursive: true, force: true }));
  cpSync(join(ROOT, 'fixtures', name), dst, { recursive: true });
  return dst;
}

const snapshot = (dir) =>
  execFileSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).split('\n').sort().join('\n');

// --- task-20-brief-raw.md Step 1's own 9 tests, kept behaviorally
// identical to the plan (same setup, same assertions) with two purely
// mechanical fixes: (1) the note directly under the code block --  "第 4
// 条测试用了顶层 await import —— 实现时改为文件顶部静态 import {
// TEMPLATE_WHITELIST } from '../scripts/lib/templates.mjs'; 测试体内直接
// 使用。" (the plan's own inline `await import(...)` inside a non-async
// arrow function would be a syntax error as written); (2) the tmpdir leak
// fix above (`t` threaded through copyFixture). Neither changes what any
// test actually verifies. ----------------------------------------------

test('dry-run plans files but writes nothing', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const before = snapshot(repo);
  const r = runScaffold({ repoPath: repo, lang: 'en', apply: false, now: NOW });
  assert.ok(r.planned.length > 0, 'bad-repo should have plenty to scaffold');
  assert.deepEqual(r.written, []);
  assert.equal(snapshot(repo), before, 'dry-run must not touch the filesystem');
});

test('--apply creates missing files from templates', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const r = runScaffold({ repoPath: repo, lang: 'en', apply: true, now: NOW });
  assert.ok(r.written.includes('AGENTS.md'));
  assert.ok(existsSync(join(repo, 'AGENTS.md')));
  assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /harness-engineering/);
});

test('existing files are never overwritten — a .harness-proposed is written instead', (t) => {
  const repo = copyFixture(t, 'mid-repo');
  const original = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  runScaffold({ repoPath: repo, lang: 'en', only: ['instructions.missing'], apply: true, now: NOW });
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), original, 'original must be untouched');
  assert.ok(existsSync(join(repo, 'AGENTS.md.harness-proposed')));
});

test('only whitelisted paths are ever written', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const before = new Set(snapshot(repo).split('\n'));
  runScaffold({ repoPath: repo, lang: 'en', apply: true, now: NOW });
  const after = snapshot(repo).split('\n').filter((f) => f && !before.has(f));
  for (const abs of after) {
    const rel = abs.slice(repo.length + 1).replace(/\.harness-proposed$/, '');
    assert.ok(TEMPLATE_WHITELIST.includes(rel), `wrote non-whitelisted path: ${rel}`);
  }
});

test('--only limits scaffolding to the named gap', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const r = runScaffold({ repoPath: repo, lang: 'en', only: ['state.no-progress'], apply: true, now: NOW });
  assert.deepEqual(r.written, ['PROGRESS.md']);
});

test('--only accepts a subsystem id and expands it', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const r = runScaffold({ repoPath: repo, lang: 'en', only: ['state'], apply: true, now: NOW });
  assert.ok(r.written.includes('PROGRESS.md'));
  assert.ok(r.written.includes('feature_list.json'));
  assert.ok(!r.written.includes('AGENTS.md'), 'must not stray outside the state subsystem');
});

test('zh templates are used when --lang zh', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  runScaffold({ repoPath: repo, lang: 'zh', only: ['state.no-progress'], apply: true, now: NOW });
  assert.match(readFileSync(join(repo, 'PROGRESS.md'), 'utf8'), /[一-龥]/, 'expected Chinese content');
});

test('generated JSON stays parseable and carries provenance', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  runScaffold({ repoPath: repo, lang: 'en', only: ['state.no-feature-list'], apply: true, now: NOW });
  const parsed = JSON.parse(readFileSync(join(repo, 'feature_list.json'), 'utf8'));
  assert.ok(Array.isArray(parsed.features));
  assert.match(parsed._generatedBy, /harness-engineering/);
});

test('an unknown --only id exits with a clear error', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  assert.throws(
    () => runScaffold({ repoPath: repo, lang: 'en', only: ['nope.nope'], apply: true, now: NOW }),
    /Unknown gap id|Unknown subsystem/,
  );
});

// --- extended coverage beyond the plan's 9 given tests --------------------
// Selecting all six subsystem ids via --only is a deterministic way to
// force every single scaffoldable template to be written in one call,
// independent of what runAssess happens to find for a given fixture (e.g.
// bad-repo alone never triggers environment.no-bootstrap /
// environment.no-container, since its `environment` score never leaves the
// gate that requires a detected stack) -- needed below to exercise
// init.sh/.devcontainer/devcontainer.json/.claude/settings.json at all.

const ALL_SUBSYSTEMS = ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop'];

// --- brief section B2: .claude/settings.json and .devcontainer/
// devcontainer.json are NOT this project's own format (Claude Code's config
// schema and the Dev Containers spec, respectively) -- stamp() must leave
// them byte-for-byte identical to the template, never injecting
// `_generatedBy` the way every other JSON template gets. Task 19 already
// made and shipped this same call for harness.config.json's `_comment`;
// this locks the analogous decision in for scaffold's own stamp step. -----

test('B2: .claude/settings.json and devcontainer.json are written verbatim, never stamped with _generatedBy', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const r = runScaffold({
    repoPath: repo, lang: 'en', only: ALL_SUBSYSTEMS, apply: true, now: NOW,
  });
  assert.equal(r.failure, undefined, JSON.stringify(r.failure));
  for (const name of ['.claude/settings.json', '.devcontainer/devcontainer.json']) {
    const written = readFileSync(join(repo, name), 'utf8');
    const original = readTemplate(name, 'en');
    assert.equal(written, original, `${name} must be written byte-for-byte identical to its template`);
    assert.doesNotMatch(written, /_generatedBy/, `${name} must not carry _generatedBy`);
  }
});

test('stamp(): foreign JSON passes through untouched; every other format gets a valid, format-appropriate marker', () => {
  const foreignJson = '{"a":1}';
  assert.equal(stamp('.claude/settings.json', foreignJson, '1.2.3'), foreignJson);
  assert.equal(stamp('.devcontainer/devcontainer.json', foreignJson, '1.2.3'), foreignJson);

  const ownJson = stamp('harness.config.json', '{"lang":"en"}', '1.2.3');
  const parsed = JSON.parse(ownJson); // must still be valid JSON
  assert.match(parsed._generatedBy, /harness-engineering/);
  assert.equal(parsed.lang, 'en');

  const md = stamp('AGENTS.md', '# Title\n', '1.2.3');
  assert.match(md, /^<!-- .*harness-engineering.* -->\n# Title\n$/);

  const sh = stamp('init.sh', '#!/usr/bin/env bash\nset -euo pipefail\n', '1.2.3');
  assert.match(sh, /^#!\/usr\/bin\/env bash\n# .*harness-engineering/, 'shebang line must stay first');

  const mk = stamp('Makefile', '.PHONY: test\n', '1.2.3');
  assert.match(mk, /^# .*harness-engineering.*\n\.PHONY: test\n$/);
});

// --- brief section B3: the same template claimed by more than one gap
// (measured against bad-repo: loop/maker-checker-loop.md is claimed by both
// loop.no-maker-checker and loop.none) must be written exactly once, never
// once per claiming gap -- otherwise `written` contains a duplicate AND a
// second write finds the first write's own output already there, degrading
// into writing both the real file and a spurious `.harness-proposed`
// alongside it in the very same run. ----------------------------------------

test('B3: a template claimed by more than one gap is written exactly once, credited to the first (highest-ROI) claimant', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const r = runScaffold({
    repoPath: repo, lang: 'en', only: ['loop'], apply: true, now: NOW,
  });
  assert.equal(r.failure, undefined, JSON.stringify(r.failure));

  const maker = r.planned.filter((p) => p.template === 'loop/maker-checker-loop.md');
  assert.equal(maker.length, 1, `loop/maker-checker-loop.md must appear exactly once in planned, got ${maker.length}`);
  // rubric.mjs declares loop.none before loop.no-maker-checker, and within
  // --only's subsystem-expansion this project resolves gaps in that
  // declaration order (see selectGapIds/resolveOnly's own comments) -- so
  // loop.none is the first (and only) claimant of record.
  assert.equal(maker[0].gapId, 'loop.none');

  assert.equal(r.written.filter((w) => w === 'loop/maker-checker-loop.md').length, 1);
  assert.ok(!r.written.includes('loop/maker-checker-loop.md.harness-proposed'), 'must not ALSO write a proposal for the same template in the same run');
  assert.equal(new Set(r.written).size, r.written.length, 'written must contain no duplicates at all');
  assert.ok(existsSync(join(repo, 'loop', 'maker-checker-loop.md')));
});

// --- brief section E1: a target's `.harness-proposed` can itself already
// exist (e.g. an earlier, not-yet-reviewed scaffold run). The never-
// overwrite guarantee draws no exception for scaffold's own prior output --
// this must escalate to `-2`, `-3`, ... rather than silently clobbering
// whatever a human may currently be reviewing or have annotated. ----------

test('E1: a pre-existing .harness-proposed is itself never overwritten -- escalates to -2, -3, ...', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  // Run 1: PROGRESS.md does not exist yet -> created for real.
  const r1 = runScaffold({ repoPath: repo, lang: 'en', only: ['state.no-progress'], apply: true, now: NOW });
  assert.deepEqual(r1.written, ['PROGRESS.md']);

  // Run 2: PROGRESS.md now exists -> proposed as PROGRESS.md.harness-proposed.
  const r2 = runScaffold({ repoPath: repo, lang: 'en', only: ['state.no-progress'], apply: true, now: NOW });
  assert.deepEqual(r2.written, ['PROGRESS.md.harness-proposed']);
  writeFileSync(join(repo, 'PROGRESS.md.harness-proposed'), 'MY OWN REVIEW NOTES, DO NOT TOUCH\n');

  // Run 3: both PROGRESS.md and PROGRESS.md.harness-proposed already exist
  // -> must escalate to -2, and must NOT disturb the hand-edited file above.
  const r3 = runScaffold({ repoPath: repo, lang: 'en', only: ['state.no-progress'], apply: true, now: NOW });
  assert.deepEqual(r3.written, ['PROGRESS.md.harness-proposed-2']);
  assert.equal(
    readFileSync(join(repo, 'PROGRESS.md.harness-proposed'), 'utf8'),
    'MY OWN REVIEW NOTES, DO NOT TOUCH\n',
    'a prior .harness-proposed must never be overwritten either',
  );
  assert.ok(existsSync(join(repo, 'PROGRESS.md.harness-proposed-2')));
});

// --- brief section E2: only a freshly CREATED init.sh gets the executable
// bit; a proposed alternative sitting next to an existing init.sh does not
// -- see runScaffold's own comment for why the safer default is "no". ----

test('E2: a freshly created init.sh is executable; a proposed init.sh is not', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const created = runScaffold({
    repoPath: repo, lang: 'en', only: ['environment.no-bootstrap'], apply: true, now: NOW,
  });
  assert.deepEqual(created.written, ['init.sh']);
  assert.equal(statSync(join(repo, 'init.sh')).mode & 0o777, 0o755);

  const proposed = runScaffold({
    repoPath: repo, lang: 'en', only: ['environment.no-bootstrap'], apply: true, now: NOW,
  });
  assert.deepEqual(proposed.written, ['init.sh.harness-proposed']);
  const proposedMode = statSync(join(repo, 'init.sh.harness-proposed')).mode & 0o777;
  assert.notEqual(proposedMode, 0o755, 'a proposed init.sh must not be made executable');
});

// --- brief section E3: a write failing partway through --apply (simulated
// here portably, without relying on permission bits that a sandboxed/root
// test runner may simply ignore, by colliding the 'loop' directory scaffold
// needs to create with a same-named plain file) must not throw an uncaught
// exception, must not roll back files already written, and must report
// exactly which entry failed and why. --------------------------------------

test('E3: a write failure partway through --apply reports failure honestly, without rollback or an uncaught throw', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  // loop.no-maker-checker's templates are ['evaluator-rubric.md' (repo
  // root, no directory needed), 'loop/maker-checker-loop.md' (needs
  // mkdirSync('loop'))], in that order -- so the first write is expected to
  // succeed for real before the second one hits the collision below.
  writeFileSync(join(repo, 'loop'), 'not a directory\n');

  const r = runScaffold({
    repoPath: repo, lang: 'en', only: ['loop.no-maker-checker'], apply: true, now: NOW,
  });

  assert.ok(r.failure, 'expected a failure to be reported, not thrown or silently ignored');
  assert.equal(r.failure.template, 'loop/maker-checker-loop.md');
  assert.deepEqual(r.written, ['evaluator-rubric.md'], 'the file written before the collision must be reported, honestly, as written');
  assert.ok(existsSync(join(repo, 'evaluator-rubric.md')), 'no rollback: the successfully-written file must still be on disk');
  assert.equal(
    readFileSync(join(repo, 'loop'), 'utf8'),
    'not a directory\n',
    'the colliding file itself must be untouched -- this tool never deletes what it did not create',
  );
});

// --- brief section D: the whitelist guard is genuine, load-bearing code,
// not decoration -- verified directly here (see task-20-report.md's
// mutation-testing section for the layered-defense finding this test is
// paired with: templates.mjs's own readTemplate/templatePath enforce the
// identical invariant one layer below, unmodifiable by this task, so no
// input reachable through the public runScaffold API can ever exercise
// this function with a bad name; this test exercises it directly instead).

test('D: assertWhitelisted rejects any name outside TEMPLATE_WHITELIST', () => {
  assert.throws(() => assertWhitelisted('../../../etc/passwd'), /non-whitelisted/);
  assert.throws(() => assertWhitelisted('random-file.txt'), /non-whitelisted/);
  for (const name of TEMPLATE_WHITELIST) assert.doesNotThrow(() => assertWhitelisted(name));
});

// --- CLI smoke coverage: none of the tests above ever go through
// scaffold.mjs's own main()/parseCli/isMainModule wiring (they all call
// runScaffold directly, same as the plan's own 9 tests) -- these do, so a
// break in the CLI plumbing itself (flag parsing, exit codes) doesn't slip
// through unexercised. -------------------------------------------------

const SCAFFOLD_BIN = join(ROOT, 'scripts', 'scaffold.mjs');

test('CLI: dry-run (no --apply) exits 0 and writes nothing', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  const before = snapshot(repo);
  const out = execFileSync('node', [SCAFFOLD_BIN, repo, '--lang', 'en'], { encoding: 'utf8' });
  assert.equal(snapshot(repo), before);
  assert.match(out, /Harness Scaffold/);
});

test('CLI: --apply writes files and exits 0', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  execFileSync('node', [SCAFFOLD_BIN, repo, '--lang', 'en', '--apply', '--only', 'state.no-progress'], { encoding: 'utf8' });
  assert.ok(existsSync(join(repo, 'PROGRESS.md')));
});

test('CLI: an invalid --lang exits 2 (usage error)', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  try {
    execFileSync('node', [SCAFFOLD_BIN, repo, '--lang', 'fr'], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected a non-zero exit');
  } catch (err) {
    assert.equal(err.status, 2);
  }
});

test('CLI: an unknown --only id exits 2 (usage error)', (t) => {
  const repo = copyFixture(t, 'bad-repo');
  try {
    execFileSync('node', [SCAFFOLD_BIN, repo, '--lang', 'en', '--only', 'nope.nope', '--apply'], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected a non-zero exit');
  } catch (err) {
    assert.equal(err.status, 2);
  }
});

// --- brief section C (dogfood, mandatory): scaffold's own output must not
// cause this project's own assess/verify to observe a self-inflicted
// failure, AND must measurably raise the score -- both languages. See
// templates.test.mjs's own "C (dogfood)" tests (Task 19) for the sibling
// requirement this one builds on: that suite proved the templates
// themselves are inert; this one proves running THIS task's own scaffold
// end-to-end against a real (if minimal) repository has the same property,
// with a real before/after score delta, not just an assertion that nothing
// crashed. ------------------------------------------------------------------

test('C (dogfood): scaffold --apply on bad-repo, then this project\'s own assess + verify --run, in both languages', async (t) => {
  for (const lang of ['en', 'zh']) {
    const repo = copyFixture(t, 'bad-repo');
    const now = NOW;

    const before = runAssess({ repoPath: repo, lang, now });
    assert.equal(before.score.total, 0, `${lang}: bad-repo's own baseline should still be exactly 0/24`);

    const scaffoldResult = runScaffold({
      repoPath: repo, lang, apply: true, now,
    });
    assert.equal(scaffoldResult.failure, undefined, `${lang}: scaffold itself must not fail: ${JSON.stringify(scaffoldResult.failure)}`);
    assert.ok(scaffoldResult.written.length > 0, `${lang}: expected scaffold to actually write something for bad-repo`);

    // Condition 1 (brief C): our own verify must never observe a failure or
    // timeout against scaffold's own output -- this is the Task-19 B1/B2
    // signature bug, re-checked end-to-end through scaffold specifically.
    const verifyReport = await runVerify({ repoPath: repo, run: true, now });
    for (const cmd of verifyReport.commands) {
      assert.notEqual(cmd.status, 'failed', `${lang}: ${cmd.role} must never be observed failed`);
      assert.notEqual(cmd.status, 'timeout', `${lang}: ${cmd.role} must never be observed timed out`);
    }
    assert.equal(verifyReport.passed, true, `${lang}: nothing declared yet is vacuously passed, not failed`);

    // Condition 2 (brief C): the score must measurably improve -- a
    // "fills gaps in" tool that leaves the score untouched is not doing its
    // job. Concrete numbers were 0/24 -> 13/24 with tools/state/loop maxed
    // at 4/4 each before Task 1 (v1.1 hardening) landed; they moved to
    // 0/24 -> 12/24 with state at 3/4 once the placeholder-detection fix
    // (placeholder.mjs) shipped -- it stops a freshly-scaffolded, still-
    // unfilled template from satisfying the handoff rung. scaffold does NOT
    // copy either template verbatim -- stamp() (scripts/scaffold.mjs)
    // always prepends a provenance line first, e.g.
    // `<!-- Generated by harness-engineering v0.1.0 -- review and fill in
    // before relying on it. -->`. session-handoff.md still carries an
    // unreplaced FILL: marker in its body regardless of that prefix, so Rule
    // A catches it either way; clean-state-checklist.md has no FILL: marker
    // at all, so it depends entirely on Rule B recognizing it as the
    // template plus a stamp -- which placeholder.mjs's Rule B only started
    // doing after fix round 2, Finding 1 (it originally compared raw bytes,
    // so the stamp alone defeated it -- see task-1-report.md's fix-round-2
    // section). Either way isFilledArtifact correctly refuses to count
    // either file until a human actually fills it in. This is the fix
    // working as intended, not a regression: re-derived directly against the
    // current code (not just adjusted to make the test pass) both when the
    // placeholder-detection fix first landed and again after fix round 2 --
    // see task-1-report.md's fix-round-1 and fix-round-2 sections for the exact
    // commands used, both confirming 12/24 and state:3. tools/loop are still
    // fully addressed by scaffold (neither one gained a placeholder-
    // detection check); only state's handoff rung changed.
    const after = runAssess({ repoPath: repo, lang, now });
    assert.ok(
      after.score.total > before.score.total,
      `${lang}: expected score to increase, got ${before.score.total} -> ${after.score.total}`,
    );
    assert.equal(after.score.total, 12, `${lang}: expected the known concrete after-score of 12/24, got ${after.score.total}`);
    const byId = Object.fromEntries(after.subsystems.map((s) => [s.id, s.score]));
    assert.equal(byId.tools, 4, `${lang}: tools should be fully addressed by scaffold`);
    // Not 4: scaffold's own session-handoff.md/clean-state-checklist.md are
    // unfilled placeholders until a human edits them (see comment above).
    assert.equal(byId.state, 3, `${lang}: state stays at 3 until the scaffolded handoff docs are actually filled in`);
    assert.equal(byId.loop, 4, `${lang}: loop should be fully addressed by scaffold`);

    // Condition 3 (brief C): whatever gaps remain must be gaps only the
    // repository owner can actually close (real stack versions, a real
    // verify command, real tests/CI/observability) -- never a gap CAUSED by
    // our own placeholder content being broken or misread.
    const remaining = after.subsystems.flatMap((s) => s.gaps.map((g) => g.id));
    const mustNotAppear = [
      'instructions.missing', 'tools.no-entrypoint', 'tools.no-permissions',
      'state.no-progress', 'state.no-feature-list', 'state.no-handoff',
      'loop.none', 'loop.no-entrypoint', 'loop.no-maker-checker', 'loop.no-stop-condition',
      'loop.no-budget-cap', 'loop.no-rollback',
      'feedback.commands-failing',
    ];
    for (const id of mustNotAppear) {
      assert.ok(!remaining.includes(id), `${lang}: unexpected self-inflicted gap "${id}" (remaining: ${remaining.join(', ')})`);
    }
    // state.handoff-unfilled belongs here, not in mustNotAppear above: it is
    // an honest report that scaffold wrote a placeholder the repo owner has
    // not yet filled in, not a bug in scaffold's own output (mustNotAppear
    // above already covers the "file is missing" gap -- state.no-handoff --
    // which correctly never fires here, since the file genuinely exists).
    const mustAppear = [
      'instructions.no-stack-versions', 'feedback.no-declared-commands', 'feedback.no-tests',
      'state.handoff-unfilled',
    ];
    for (const id of mustAppear) {
      assert.ok(remaining.includes(id), `${lang}: expected honest gap "${id}" to remain -- only the repo owner can supply this`);
    }
  }
});
