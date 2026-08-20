import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, renderMarkdown, SCHEMA_VERSION } from '../scripts/lib/report.mjs';

const NOW = new Date('2026-08-10T12:00:00Z');

// loop.score is deliberately nonzero (2, not 0). Review finding: with every
// score summed via SUBSYSTEMS.reduce(...), a 0 is the additive identity — a
// bug that double-counts, drops, or swaps loop's contribution to score.total
// is invisible if loop contributes nothing to the sum either way. score: 2 +
// gapIds: ['loop.no-budget-cap'] also mirrors a real loop.mjs output at that
// score (rungs 1-2 passed => past 'loop.none', rung 3 partially failing).
const results = {
  instructions: { score: 4, cappedByEvidence: false, evidence: [{ kind: 'file', path: 'AGENTS.md', note: '80 lines' }], gapIds: [] },
  tools: { score: 3, cappedByEvidence: false, evidence: [], gapIds: ['tools.no-least-privilege-doc'] },
  environment: { score: 3, cappedByEvidence: true, evidence: [], gapIds: ['environment.no-container'] },
  // gapVars mirrors what state.mjs really returns: the handoff gaps name
  // the specific artefact that caused them, so buildReport has to be handed
  // the substitution values along with the gap id.
  state: {
    score: 3, cappedByEvidence: false, evidence: [], gapIds: ['state.no-handoff'],
    gapVars: { 'state.no-handoff': { artefacts: 'session-handoff.md' } },
  },
  feedback: { score: 2, cappedByEvidence: true, evidence: [], gapIds: ['feedback.commands-unverified'] },
  loop: { score: 2, cappedByEvidence: false, evidence: [], gapIds: ['loop.no-budget-cap'] },
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
  assert.deepEqual(r.score, { total: 17, max: 24 });
  // task-15 extends the evidence object with `reason` (null when a valid
  // reason wasn't supplied to this low-level buildReport call — the actual
  // "why" invariant is enforced by assess.mjs's runAssess, not by
  // buildReport itself, which just carries whatever the caller passed).
  assert.deepEqual(r.evidence, { verified: false, verifiedAt: null, reason: null });
});

test('subsystems appear in canonical order with max 4', () => {
  const r = build();
  assert.deepEqual(r.subsystems.map((s) => s.id),
    ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop']);
  for (const s of r.subsystems) assert.equal(s.max, 4);
});

test('gap ids expand into full gap objects with roi', () => {
  const gap = build().subsystems.find((s) => s.id === 'loop').gaps[0];
  assert.equal(gap.id, 'loop.no-budget-cap');
  assert.equal(gap.severity, 'high');
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
  assert.match(en, /Score: 17 \/ 24/);
  assert.match(en, /Level: L3 Continuous/);
  const zh = renderMarkdown(build({ lang: 'zh' }), 'zh');
  assert.match(zh, /得分：17 \/ 24/);
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

/**
 * A results object with every subsystem at 0 and no gaps except state's.
 *
 * The two handoff gap messages interpolate `{artefacts}`, so any caller that
 * asks for one of them must supply the vars a real scorer would — buildReport
 * refuses to materialize a message with an unsubstituted placeholder. Filled
 * in here for the whole file rather than at each call site: which artefact is
 * named is irrelevant to every suppression test below, but the vars have to
 * exist for the report to build at all.
 */
const HANDOFF_GAP_VARS = {
  'state.no-handoff': { artefacts: 'session-handoff.md' },
  'state.handoff-unfilled': { artefacts: 'clean-state-checklist.md' },
};

function resultsWithStateGaps(gapIds) {
  const empty = { score: 0, cappedByEvidence: false, evidence: [], gapIds: [] };
  const gapVars = Object.fromEntries(
    gapIds.filter((id) => id in HANDOFF_GAP_VARS).map((id) => [id, HANDOFF_GAP_VARS[id]]),
  );
  return {
    instructions: empty, tools: empty, environment: empty,
    state: { score: 0, cappedByEvidence: false, evidence: [], gapIds, gapVars },
    feedback: empty, loop: empty,
  };
}

const REPORT_ARGS = {
  repo: '/fake', stack: [], hasEvidence: false, evidenceReason: 'missing',
  verifiedAt: null, toolVersion: '0.1.0', now: new Date('2026-08-20T00:00:00Z'), lang: 'en',
};

// "No progress file" and "Progress file is stale" used to appear in the
// same report — the second presupposes a file the first just said does not
// exist.
test('gaps that presuppose a missing file are suppressed when it is missing', () => {
  const report = buildReport({
    ...REPORT_ARGS,
    results: resultsWithStateGaps(['state.no-progress', 'state.progress-stale', 'state.progress-incomplete']),
  });
  const ids = report.subsystems.find((s) => s.id === 'state').gaps.map((g) => g.id);
  assert.deepEqual(ids, ['state.no-progress']);
});

test('a presupposing gap survives when its precondition gap is absent', () => {
  const report = buildReport({
    ...REPORT_ARGS,
    results: resultsWithStateGaps(['state.progress-stale']),
  });
  const ids = report.subsystems.find((s) => s.id === 'state').gaps.map((g) => g.id);
  assert.deepEqual(ids, ['state.progress-stale']);
});

test('suppression does not change the score', () => {
  const report = buildReport({
    ...REPORT_ARGS,
    results: resultsWithStateGaps(['state.no-progress', 'state.progress-stale']),
  });
  assert.equal(report.subsystems.find((s) => s.id === 'state').score, 0);
  assert.equal(report.score.total, 0);
});

test('the rendered markdown no longer shows both progress gaps at once', () => {
  const report = buildReport({
    ...REPORT_ARGS,
    results: resultsWithStateGaps(['state.no-progress', 'state.progress-stale']),
  });
  const md = renderMarkdown(report, 'en');
  assert.ok(md.includes('No progress file'));
  assert.ok(!/Progress file is stale/.test(md));
});

// Fix round 1, Finding 1: state.no-handoff and state.handoff-unfilled are
// NOT a presupposing pair, even though tests/scorers/state.test.mjs already
// proves the scorer can emit both together (one handoff artefact absent,
// the other present-but-unfilled -- two distinct real problems about two
// different files, not one gap presupposing what the other denies; see the
// comment on state.handoff-unfilled's def() in rubric.mjs). Nothing before
// this test exercised that pair through buildReport, so a future
// presupposedBy edit wiring these two together would have silently
// regressed with no test catching it.
test('state.no-handoff and state.handoff-unfilled both survive un-suppressed', () => {
  const report = buildReport({
    ...REPORT_ARGS,
    results: resultsWithStateGaps(['state.no-handoff', 'state.handoff-unfilled']),
  });
  const ids = report.subsystems.find((s) => s.id === 'state').gaps.map((g) => g.id);
  assert.deepEqual(new Set(ids), new Set(['state.no-handoff', 'state.handoff-unfilled']));
});
