import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, renderMarkdown, SCHEMA_VERSION } from '../scripts/lib/report.mjs';

const NOW = new Date('2026-08-10T12:00:00Z');

const results = {
  instructions: { score: 4, cappedByEvidence: false, evidence: [{ kind: 'file', path: 'AGENTS.md', note: '80 lines' }], gapIds: [] },
  tools: { score: 3, cappedByEvidence: false, evidence: [], gapIds: ['tools.no-least-privilege-doc'] },
  environment: { score: 3, cappedByEvidence: true, evidence: [], gapIds: ['environment.no-container'] },
  state: { score: 3, cappedByEvidence: false, evidence: [], gapIds: ['state.no-handoff'] },
  feedback: { score: 2, cappedByEvidence: true, evidence: [], gapIds: ['feedback.commands-unverified'] },
  loop: { score: 0, cappedByEvidence: false, evidence: [], gapIds: ['loop.none'] },
};

// `lang: 'en'` is required here (task-14 brief section C): per the ruling in
// section B, buildReport materializes translated text (gap title/why/fix,
// level.name) into the JSON at build time, so `lang` is one of buildReport's
// own inputs, not only renderMarkdown's.
const build = (over = {}) => buildReport({
  repo: '/tmp/demo', stack: ['go'], results, hasEvidence: false,
  verifiedAt: null, toolVersion: '0.1.0', now: NOW, lang: 'en', ...over,
});

test('report matches the documented schema shape', () => {
  const r = build();
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(r.tool, { name: 'harness-engineering', version: '0.1.0' });
  assert.equal(r.repo, '/tmp/demo');
  assert.equal(r.generatedAt, NOW.toISOString());
  assert.deepEqual(r.stack, ['go']);
  assert.deepEqual(r.score, { total: 15, max: 24 });
  assert.deepEqual(r.evidence, { verified: false, verifiedAt: null });
});

test('subsystems appear in canonical order with max 4', () => {
  const r = build();
  assert.deepEqual(r.subsystems.map((s) => s.id),
    ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop']);
  for (const s of r.subsystems) assert.equal(s.max, 4);
});

test('gap ids expand into full gap objects with roi', () => {
  const gap = build().subsystems.find((s) => s.id === 'loop').gaps[0];
  assert.equal(gap.id, 'loop.none');
  assert.equal(gap.severity, 'low');
  assert.equal(typeof gap.roi, 'number');
  assert.ok(gap.roi >= 1 && gap.roi <= 10);
  assert.ok(gap.title && gap.why && gap.fix, 'localized text must be materialized');
});

test('gap objects match spec 6.3 shape — no leaked internal rubric fields', () => {
  const gap = build().subsystems.find((s) => s.id === 'tools').gaps[0];
  assert.deepEqual(Object.keys(gap).sort(),
    ['fix', 'id', 'roi', 'scaffoldable', 'severity', 'title', 'why'].sort());
});

test('level is computed from scores and evidence flag', () => {
  assert.equal(build().level.id, 3);
  assert.equal(build({ hasEvidence: true }).level.id, 3, 'feedback=2 still blocks L4');
});

test('level.name is a materialized translated string, not an i18n key', () => {
  assert.equal(build({ lang: 'en' }).level.name, 'Continuous');
  assert.equal(build({ lang: 'zh' }).level.name, '可续跑');
});

test('level carries unmetGates for the next gate up', () => {
  const gates = build().level.unmetGates;
  assert.ok(Array.isArray(gates) && gates.length > 0);
});

// Controller ruling (task-14 brief section B) makes buildReport's output
// language-dependent: level.name and every gap's title/why/fix are
// materialized in the report's `lang` at build time. That means a single
// report object cannot legitimately be rendered in two languages — feeding
// an en-built report into renderMarkdown(report, 'zh') would produce a
// half-translated document (zh headings, en gap text). So — deviating from
// the plan's literal test body, which reused one build() result for both
// renders — this test builds two reports, one per language, and renders
// each with its own matching lang.
test('markdown renders in both languages with score and level', () => {
  const en = renderMarkdown(build({ lang: 'en' }), 'en');
  assert.match(en, /Score: 15 \/ 24/);
  assert.match(en, /Level: L3 Continuous/);
  const zh = renderMarkdown(build({ lang: 'zh' }), 'zh');
  assert.match(zh, /得分：15 \/ 24/);
  assert.match(zh, /等级：L3 可续跑/);
});

test('capped subsystems are marked in the rendered output', () => {
  assert.match(renderMarkdown(build(), 'en'), /capped/i);
});

test('gaps are rendered sorted by roi descending across the whole report', () => {
  const md = renderMarkdown(build(), 'en');
  const rois = [...md.matchAll(/ROI (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(rois.length >= 5, 'expected every subsystem gap to appear in the global list');
  assert.deepEqual(rois, [...rois].sort((a, b) => b - a));
});

test('markdown reports "no gaps" when a subsystem set has none', () => {
  const clean = {
    instructions: { score: 4, cappedByEvidence: false, evidence: [], gapIds: [] },
    tools: { score: 4, cappedByEvidence: false, evidence: [], gapIds: [] },
    environment: { score: 4, cappedByEvidence: false, evidence: [], gapIds: [] },
    state: { score: 4, cappedByEvidence: false, evidence: [], gapIds: [] },
    feedback: { score: 4, cappedByEvidence: false, evidence: [], gapIds: [] },
    loop: { score: 4, cappedByEvidence: false, evidence: [], gapIds: [] },
  };
  const r = buildReport({
    repo: '/tmp/clean', stack: [], results: clean, hasEvidence: true,
    verifiedAt: NOW, toolVersion: '0.1.0', now: NOW, lang: 'en',
  });
  assert.match(renderMarkdown(r, 'en'), /No gaps found\./);
});

test('buildReport is pure — same input yields identical JSON', () => {
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

// Section B flags a real risk: once buildReport takes `lang`, the same repo
// run with --lang en vs --lang zh produces different JSON. That difference
// is intentional (the report is for humans), but it must not be confused
// with nondeterminism — guard both halves of the contract explicitly.
test('buildReport output differs by lang, but is stable within a lang', () => {
  const en = build({ lang: 'en' });
  const zh = build({ lang: 'zh' });
  assert.notEqual(JSON.stringify(en), JSON.stringify(zh), 'lang must affect materialized text');
  assert.equal(JSON.stringify(build({ lang: 'zh' })), JSON.stringify(zh), 'same lang must stay byte-identical');
});
