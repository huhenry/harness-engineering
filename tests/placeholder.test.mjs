import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { isFilledArtifact } from '../scripts/lib/placeholder.mjs';
import { runScaffold } from '../scripts/scaffold.mjs';
import { createScanContext } from '../scripts/lib/scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal stand-in for scan.mjs's context — isFilledArtifact only reads. */
function ctxOf(files) {
  return { read: (rel) => files[rel] ?? null };
}

test('a file that does not exist is not a filled artefact', () => {
  assert.equal(isFilledArtifact(ctxOf({}), 'session-handoff.md'), false);
});

test('ordinary filled-in prose is a filled artefact', () => {
  const ctx = ctxOf({ 'session-handoff.md': '# Handoff\n\nShipped the parser.\n' });
  assert.equal(isFilledArtifact(ctx, 'session-handoff.md'), true);
});

// Rule A: an unreplaced FILL: marker means nobody filled this in.
test('a file still carrying a FILL: marker is not a filled artefact', () => {
  const ctx = ctxOf({ 'session-handoff.md': '# Handoff\n\n<!-- FILL: what happened -->\n' });
  assert.equal(isFilledArtifact(ctx, 'session-handoff.md'), false);
});

// Rule A must require the colon. templates/en/Makefile's own line 2 reads
// "# placeholder until the FILL lines are replaced" -- that is prose ABOUT
// placeholders, not a placeholder. A loose /FILL/ regex misjudges it.
test('prose mentioning FILL without a colon is still a filled artefact', () => {
  const ctx = ctxOf({ 'notes.md': '# Notes\n\nReplace the FILL lines before shipping.\n' });
  assert.equal(isFilledArtifact(ctx, 'notes.md'), true);
});

// Rule B: byte-identical to a shipped template means it was vendored, not written.
test('a file byte-identical to a shipped en template is not a filled artefact', () => {
  const text = readFileSync(join(ROOT, 'templates', 'en', 'session-handoff.md'), 'utf8');
  assert.equal(isFilledArtifact(ctxOf({ 'docs/session-handoff.md': text }), 'docs/session-handoff.md'), false);
});

// Fix round 2, Finding 3: this used to compare session-handoff.md, which
// carries a FILL: marker in zh too -- so it always passed via Rule A first,
// and Rule B's zh half was never actually exercised (the reviewer
// mutation-proved this: swapping SUPPORTED_LANGS for ['en'] left the whole
// suite green). clean-state-checklist.md has no FILL: marker in either
// language, so Rule B is the only thing that can make this pass.
test('a file byte-identical to a shipped zh template is not a filled artefact (Rule B only, no FILL: marker)', () => {
  const text = readFileSync(join(ROOT, 'templates', 'zh', 'clean-state-checklist.md'), 'utf8');
  assert.ok(!text.includes('FILL:'), 'precondition: this template has no FILL: marker, so only Rule B can catch it');
  assert.equal(isFilledArtifact(ctxOf({ 'clean-state-checklist.md': text }), 'clean-state-checklist.md'), false);
});

// The case Rule A alone cannot catch: this template carries no FILL: marker
// at all, so only the byte-identity rule stops it counting. The state
// scorer's handoff check covers BOTH session-handoff.md and
// clean-state-checklist.md -- Rule A only covers the first one.
test('clean-state-checklist.md needs rule B: the template has no FILL: marker', () => {
  const text = readFileSync(join(ROOT, 'templates', 'en', 'clean-state-checklist.md'), 'utf8');
  assert.ok(!text.includes('FILL:'), 'precondition: this template has no FILL: marker');
  assert.equal(isFilledArtifact(ctxOf({ 'clean-state-checklist.md': text }), 'clean-state-checklist.md'), false);
});

// A repository that took the template and actually edited it gets credit.
test('an edited copy of a template is a filled artefact', () => {
  const text = readFileSync(join(ROOT, 'templates', 'en', 'clean-state-checklist.md'), 'utf8');
  const edited = `${text}\n- [ ] Our own extra check.\n`;
  assert.equal(isFilledArtifact(ctxOf({ 'clean-state-checklist.md': edited }), 'clean-state-checklist.md'), true);
});

// Fix round 1, Finding 1: tests/packaging.test.mjs's "fully detached plugin
// install" test proved assess crashes with an uncaught ENOENT when it runs
// from a scripts/-only install (e.g. a script-only Claude Code plugin cache
// copy) that has no templates/ directory beside scripts/lib/placeholder.mjs.
// Reproduce that exact shape here, in-process: copy only the module files
// placeholder.mjs actually needs -- templates.mjs, i18n.mjs, cli.mjs, and
// placeholder.mjs itself -- into a fresh scripts/lib/ tree with no
// templates/ directory next to it, then dynamically import THAT copy (a
// distinct module instance/URL, so its lazily-built shippedTexts cache is
// independent of the isFilledArtifact imported at the top of this file,
// which by now has almost certainly already populated its cache from this
// repository's real templates/).
test('isFilledArtifact degrades gracefully when the shipped-template set cannot be read', async (t) => {
  const dst = mkdtempSync(join(tmpdir(), 'harness-placeholder-no-templates-'));
  t.after(() => rmSync(dst, { recursive: true, force: true }));
  mkdirSync(join(dst, 'scripts', 'lib'), { recursive: true });
  for (const rel of ['templates.mjs', 'i18n.mjs', 'cli.mjs', 'placeholder.mjs']) {
    cpSync(join(ROOT, 'scripts', 'lib', rel), join(dst, 'scripts', 'lib', rel));
  }
  assert.ok(!existsSync(join(dst, 'templates')), 'precondition: this copy has no templates/ directory at all');

  const detached = await import(pathToFileURL(join(dst, 'scripts', 'lib', 'placeholder.mjs')).href);

  // Rule A never touches templates/, so it must still work unconditionally.
  const unfilled = ctxOf({ 'session-handoff.md': '# Handoff\n\n<!-- FILL: what happened -->\n' });
  assert.equal(detached.isFilledArtifact(unfilled, 'session-handoff.md'), false);

  // Rule B degrades to "nothing is a known shipped template" instead of
  // throwing: this must not crash, and ordinary filled-in prose (which was
  // never going to match any template anyway) is still judged filled-in.
  const filled = ctxOf({ 'session-handoff.md': '# Handoff\n\nShipped the parser.\n' });
  assert.equal(detached.isFilledArtifact(filled, 'session-handoff.md'), true);
});

// Fix round 2, Finding 1 (CRITICAL): the exact reproduction that caught the
// bug --  `scaffold --apply`, then check the handoff artefacts before
// anyone edits anything -- run for real, against real scaffold output and a
// real scan context, not the hand-written strings every other test above
// uses. A unit test built from hand-written strings would not have caught
// this: it would have had to already know to reproduce stamp()'s exact
// prepended line, which is exactly the detail this bug slipped through.
// `clean-state-checklist.md` in particular has no FILL: marker at all, so
// before this fix it was judged "filled" the moment scaffold wrote it,
// without a single byte of it ever being read by a human.
test('a freshly scaffolded session-handoff.md and clean-state-checklist.md are both judged unfilled', async (t) => {
  const dst = mkdtempSync(join(tmpdir(), 'harness-placeholder-scaffold-'));
  t.after(() => rmSync(dst, { recursive: true, force: true }));

  const result = runScaffold({
    repoPath: dst, lang: 'en', apply: true, only: ['state.no-handoff'], now: new Date(),
  });
  assert.equal(result.failure, undefined, `scaffold itself must not fail: ${JSON.stringify(result.failure)}`);
  assert.ok(existsSync(join(dst, 'session-handoff.md')), 'precondition: scaffold actually wrote session-handoff.md');
  assert.ok(existsSync(join(dst, 'clean-state-checklist.md')), 'precondition: scaffold actually wrote clean-state-checklist.md');

  const ctx = createScanContext(dst);
  assert.equal(isFilledArtifact(ctx, 'session-handoff.md'), false);
  assert.equal(isFilledArtifact(ctx, 'clean-state-checklist.md'), false);
});
