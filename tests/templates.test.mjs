import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TEMPLATE_WHITELIST, templatePath, readTemplate } from '../scripts/lib/templates.mjs';
import { GAPS } from '../scripts/lib/rubric.mjs';
import { parseMarkdown, findSection } from '../scripts/lib/markdown.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { createScanContext } from '../scripts/lib/scan.mjs';
import { runVerify } from '../scripts/verify.mjs';
import { runAssess } from '../scripts/assess.mjs';

const LANGS = ['en', 'zh'];

/** Write every whitelisted template for `lang` into `dir`, creating nested
 * directories (.claude/, .devcontainer/, loop/) as needed -- this is what
 * Task 20's `scaffold` will eventually do for real, and it's exactly what
 * the dogfood tests in section C below need to set up. */
function writeScaffold(dir, lang, { skip = [] } = {}) {
  for (const name of TEMPLATE_WHITELIST) {
    if (skip.includes(name)) continue;
    const dest = join(dir, ...name.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readTemplate(name, lang));
  }
}

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// --- plan skeleton's own 8 tests (task-19-brief-raw.md Step 1), kept as
// the baseline structural contract every template must satisfy. ----------

test('every whitelisted template exists in both languages', () => {
  for (const name of TEMPLATE_WHITELIST) {
    for (const lang of LANGS) {
      assert.ok(existsSync(templatePath(name, lang)), `missing ${lang}/${name}`);
    }
  }
});

test('every scaffoldable gap references only whitelisted templates', () => {
  for (const gap of GAPS) {
    for (const tpl of gap.templates) {
      assert.ok(TEMPLATE_WHITELIST.includes(tpl), `${gap.id} references unlisted template ${tpl}`);
    }
  }
});

test('AGENTS.md template has the required sections and stays under 150 lines', () => {
  for (const lang of LANGS) {
    const md = parseMarkdown(readTemplate('AGENTS.md', lang));
    assert.ok(md.lineCount <= 150, `${lang} AGENTS.md is ${md.lineCount} lines`);
    for (const re of [/setup|安装|准备/i, /verif|验证/i, /constraint|约束|禁止/i, /session|会话/i]) {
      assert.ok(findSection(md, re), `${lang} AGENTS.md missing section ${re}`);
    }
  }
});

test('JSON templates parse and carry the expected keys', () => {
  for (const lang of LANGS) {
    const cfg = JSON.parse(readTemplate('harness.config.json', lang));
    for (const role of ['bootstrap', 'test', 'lint', 'typecheck', 'e2e', 'smoke']) {
      assert.ok(Object.hasOwn(cfg.verify, role), `${lang} config missing role ${role}`);
    }
    const settings = JSON.parse(readTemplate('.claude/settings.json', lang));
    assert.ok(Array.isArray(settings.permissions.allow));
    assert.ok(Array.isArray(settings.permissions.deny));
    const fl = JSON.parse(readTemplate('feature_list.json', lang));
    assert.ok(Array.isArray(fl.features));
  }
});

test('init.sh is a strict bash script', () => {
  for (const lang of LANGS) {
    const sh = readTemplate('init.sh', lang);
    assert.match(sh, /^#!\/usr\/bin\/env bash/);
    assert.match(sh, /set -euo pipefail/);
  }
});

test('clean-state checklist has at least five checkboxes', () => {
  for (const lang of LANGS) {
    const boxes = readTemplate('clean-state-checklist.md', lang).match(/^- \[ \]/gm) ?? [];
    assert.ok(boxes.length >= 5, `${lang} has only ${boxes.length}`);
  }
});

test('loop templates document stop conditions and budget caps', () => {
  for (const lang of LANGS) {
    for (const name of ['loop/goal-loop.md', 'loop/timer-loop.md']) {
      const text = readTemplate(name, lang);
      assert.match(text, /stop condition|停止条件/i, `${lang}/${name} stop condition`);
      assert.match(text, /budget|max iterations|预算|最大迭代/i, `${lang}/${name} budget`);
    }
  }
});

test('no template contains TODO or TBD placeholders', () => {
  for (const lang of LANGS) {
    for (const name of TEMPLATE_WHITELIST) {
      assert.doesNotMatch(readTemplate(name, lang), /\b(TODO|TBD)\b/, `${lang}/${name}`);
    }
  }
});

// --- extended structural coverage: the whitelist table (task-19-brief-
// raw.md) specifies required structure for all 16 templates, but the plan's
// own Step-1 skeleton only wrote out illustrative tests for 8 of them.
// These cover the rest, so a future edit that silently breaks e.g.
// PROGRESS.md's three sections doesn't slip through unnoticed. -------------

test('CLAUDE.md stays within 5 lines and points at AGENTS.md', () => {
  for (const lang of LANGS) {
    const text = readTemplate('CLAUDE.md', lang);
    const md = parseMarkdown(text);
    assert.ok(md.lineCount <= 5, `${lang} CLAUDE.md is ${md.lineCount} lines`);
    assert.match(text, /AGENTS\.md/);
  }
});

test('PROGRESS.md has Done / In Progress / Blocked sections', () => {
  for (const lang of LANGS) {
    const md = parseMarkdown(readTemplate('PROGRESS.md', lang));
    for (const re of [/done|完成/i, /progress|进行/i, /block|阻塞/i]) {
      assert.ok(findSection(md, re), `${lang} PROGRESS.md missing section matching ${re}`);
    }
  }
});

test('feature_list.schema.json declares $schema and properties.features', () => {
  for (const lang of LANGS) {
    const schema = JSON.parse(readTemplate('feature_list.schema.json', lang));
    assert.ok(schema.$schema, `${lang}: missing $schema`);
    assert.ok(schema.properties && schema.properties.features, `${lang}: missing properties.features`);
  }
});

test('evaluator-rubric.md documents pass and fail criteria', () => {
  for (const lang of LANGS) {
    const text = readTemplate('evaluator-rubric.md', lang);
    assert.match(text, /pass criteria|通过判据/i, `${lang}: missing pass criteria`);
    assert.match(text, /fail criteria|不通过判据/i, `${lang}: missing fail criteria`);
  }
});

test('Makefile declares test, lint and check targets', () => {
  for (const lang of LANGS) {
    const text = readTemplate('Makefile', lang);
    assert.match(text, /^test:/m, `${lang}: missing test: target`);
    assert.match(text, /^lint:/m, `${lang}: missing lint: target`);
    assert.match(text, /^check:/m, `${lang}: missing check: target`);
  }
});

test('.devcontainer/devcontainer.json is valid JSON with an image or build key', () => {
  for (const lang of LANGS) {
    const cfg = JSON.parse(readTemplate('.devcontainer/devcontainer.json', lang));
    assert.ok(cfg.image || cfg.build, `${lang}: expected an image or build key`);
  }
});

test('session-handoff.md documents previous session, next steps and blockers', () => {
  for (const lang of LANGS) {
    const text = readTemplate('session-handoff.md', lang);
    assert.match(text, /previous session|last session|上一会话/i, `${lang}: missing previous-session section`);
    assert.match(text, /next session|next steps|下一步/i, `${lang}: missing next-session section`);
    assert.match(text, /blocked|阻塞/i, `${lang}: missing blocked section`);
  }
});

test('loop/maker-checker-loop.md documents maker, checker and rollback', () => {
  for (const lang of LANGS) {
    const text = readTemplate('loop/maker-checker-loop.md', lang);
    assert.match(text, /maker/i, `${lang}: missing maker section`);
    assert.match(text, /checker/i, `${lang}: missing checker section`);
    assert.match(text, /rollback|回滚/i, `${lang}: missing rollback section`);
  }
});

// --- brief section B3: templatePath must validate `lang` through i18n.mjs's
// own assertLang, not join it straight into the path unchecked. Measured by
// the controller before dispatch: templatePath('AGENTS.md', '../../../etc')
// resolved to a path outside templates/ entirely. -------------------------

test('B3: templatePath rejects a path-traversal or unsupported lang instead of joining it into the path', () => {
  assert.throws(() => templatePath('AGENTS.md', '../../../etc'), /Unsupported language/);
  assert.throws(() => templatePath('AGENTS.md', 'fr'), /Unsupported language/);
  assert.throws(() => templatePath('AGENTS.md', ''), /Unsupported language/);
});

// --- brief section B1: an unfilled AGENTS.md Verification block must read
// as "nothing declared", never as a real (and therefore crashing) command.
// Measured by the controller against the plan's own `<!-- FILL -->`-in-a-
// fence skeleton before dispatch: loadConfig classified it as a literal
// shell command, and verify --run then failed it with a shell syntax error.
// -----------------------------------------------------------------------

test('B1: an unfilled AGENTS.md Verification block is read as "nothing declared", never a real command', (t) => {
  for (const lang of LANGS) {
    const dir = tempDir(t, `harness-b1-${lang}-`);
    writeFileSync(join(dir, 'AGENTS.md'), readTemplate('AGENTS.md', lang));
    const config = loadConfig(createScanContext(dir));
    for (const role of ['test', 'lint']) {
      assert.equal(config.verify[role], null, `${lang}: verify.${role} should be null, not a placeholder command`);
    }
  }
});

// --- brief section B2: harness.config.json's verify roles must be `null`,
// never a placeholder string like "__FILL__" -- a placeholder string is a
// real command as far as loadConfig/verify are concerned, and gets spawned
// and observed to fail (exit 127, command not found). ---------------------

test('B2: harness.config.json template declares all six verify roles as null, not a placeholder string', () => {
  for (const lang of LANGS) {
    const cfg = JSON.parse(readTemplate('harness.config.json', lang));
    for (const role of ['bootstrap', 'test', 'lint', 'typecheck', 'e2e', 'smoke']) {
      assert.equal(cfg.verify[role], null, `${lang}: verify.${role} should be null`);
    }
  }
});

// --- brief section C ("must actually execute both init.sh templates and
// confirm they exit 0 -- do not just assert on their text"). -------------

test('C: both init.sh templates actually execute successfully (real spawn, real exit code)', (t) => {
  for (const lang of LANGS) {
    const dir = tempDir(t, `harness-initsh-${lang}-`);
    const scriptPath = join(dir, 'init.sh');
    writeFileSync(scriptPath, readTemplate('init.sh', lang));
    const result = spawnSync('bash', [scriptPath], { cwd: dir, encoding: 'utf8' });
    assert.equal(
      result.status,
      0,
      `${lang}/init.sh exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
});

// --- brief section C, the dogfood requirement: drop the templates into a
// real temp repo and run this project's own loadConfig/verify/assess
// against them, in both languages, and assert that nothing in the pipeline
// is fooled by our own placeholder content. --------------------------------

test('C (dogfood): a full bilingual scaffold produces zero declared verify commands and zero self-inflicted gaps', async (t) => {
  for (const lang of LANGS) {
    const dir = tempDir(t, `harness-scaffold-${lang}-`);
    writeScaffold(dir, lang);
    const now = new Date();

    const verifyReport = await runVerify({ repoPath: dir, run: true, now });
    // Condition 1 (brief C): no verify command may ever be observed
    // executed-and-failed. With harness.config.json's verify roles all
    // null (B2's fix) there must be nothing declared to even attempt.
    assert.deepEqual(
      verifyReport.commands, [],
      `${lang}: expected zero declared commands, got ${JSON.stringify(verifyReport.commands)}`,
    );
    assert.equal(verifyReport.passed, true, `${lang}: a repo with nothing declared is vacuously passed`);
    for (const cmd of verifyReport.commands) {
      assert.notEqual(cmd.status, 'failed', `${lang}: ${cmd.role} must never be observed failed`);
      assert.notEqual(cmd.status, 'timeout', `${lang}: ${cmd.role} must never be observed timed out`);
    }

    const report = runAssess({ repoPath: dir, lang, now });
    const allGaps = report.subsystems.flatMap((s) => s.gaps.map((g) => g.id));

    // Condition 2 (brief C): no gap may be caused by our own placeholder
    // content being BROKEN or MISREAD -- a broken link from FILL text, an
    // invalid feature_list.json, a dangling `make` reference in AGENTS.md,
    // or (the B1/B2 signature bug itself) a declared command read as having
    // failed.
    //
    // The condition is deliberately narrower than "no gap may come from our
    // own placeholders at all", which is what it used to say and what this
    // list has never actually asserted. state.handoff-unfilled is exactly
    // such a gap and it is CORRECT: scaffold wrote a placeholder, nobody has
    // filled it in yet, and saying so is the whole point of the placeholder
    // rule. It belongs in mustAppear below, the same way
    // tests/scaffold.e2e.test.mjs's sibling dogfood test files it -- the two
    // tests are the same shape and must not disagree about whether this gap
    // is expected. What must never appear is the "file is missing" gap,
    // state.no-handoff, which is in the list below.
    const mustNotAppear = [
      'instructions.missing', 'instructions.no-setup-commands', 'instructions.no-constraints',
      'instructions.no-verification', 'instructions.too-long', 'instructions.stale-links',
      'tools.no-entrypoint', 'tools.broken-entrypoint', 'tools.no-permissions', 'tools.no-least-privilege-doc',
      'state.no-progress', 'state.progress-stale', 'state.progress-incomplete',
      'state.no-feature-list', 'state.feature-list-invalid', 'state.no-handoff', 'state.lifecycle-undocumented',
      'feedback.commands-failing',
      'loop.none', 'loop.no-entrypoint', 'loop.no-stop-condition', 'loop.no-budget-cap',
      'loop.no-maker-checker', 'loop.no-rollback',
    ];
    for (const id of mustNotAppear) {
      assert.ok(!allGaps.includes(id), `${lang}: unexpected self-inflicted gap "${id}" (all gaps: ${allGaps.join(', ')})`);
    }

    // Sanity check the other direction: a scaffold with no real code yet
    // legitimately still has real, honest gaps (no verify commands filled
    // in, no tests, no pinned stack). If these ever disappeared, this test
    // would have stopped actually exercising the real scorers.
    const mustAppear = [
      'feedback.no-declared-commands', 'feedback.no-tests', 'instructions.no-stack-versions',
      // Asserted, not merely tolerated: a scaffold that stopped reporting
      // its own unfilled handoff placeholders would mean the placeholder
      // rule had silently stopped working.
      'state.handoff-unfilled',
    ];
    for (const id of mustAppear) {
      assert.ok(allGaps.includes(id), `${lang}: expected honest gap "${id}" to still be present for a code-free scaffold`);
    }
  }
});

test('C (dogfood): AGENTS.md alone (no harness.config.json), in both languages, never declares a crashing placeholder command', async (t) => {
  for (const lang of LANGS) {
    const dir = tempDir(t, `harness-scaffold-agentsonly-${lang}-`);
    writeScaffold(dir, lang, { skip: ['harness.config.json'] });
    const now = new Date();

    const verifyReport = await runVerify({ repoPath: dir, run: true, now });
    assert.deepEqual(
      verifyReport.commands, [],
      `${lang}: AGENTS.md-only scaffold must declare zero commands, got ${JSON.stringify(verifyReport.commands)}`,
    );
    assert.equal(verifyReport.passed, true);
  }
});
