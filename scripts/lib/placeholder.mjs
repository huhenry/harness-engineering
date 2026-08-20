import { TEMPLATE_WHITELIST, readTemplate } from './templates.mjs';
import { SUPPORTED_LANGS } from './i18n.mjs';

/**
 * Rule A -- an unreplaced placeholder marker.
 *
 * The colon is load-bearing, not decoration. templates/en/Makefile's own
 * line 2 reads "# placeholder until the FILL lines are replaced": that is
 * prose ABOUT placeholders, and a bare /FILL/ would misjudge the whole file
 * as unfilled. Every real marker this project emits is written `FILL:`
 * (`<!-- FILL: ... -->` in markdown, `# FILL: ...` in Makefile/sh).
 */
const FILL_MARKER = /FILL:/;

/**
 * Rule B -- byte-identical to something this project ships as a template.
 *
 * Compared against EVERY shipped template's text rather than only the
 * same-named one: a repository that vendors our session-handoff.md under
 * some other name has still not written a handoff document, and matching by
 * content avoids a basename-mapping table that could drift out of sync with
 * TEMPLATE_WHITELIST (this codebase has been bitten by hand-synced parallel
 * lists four times -- see scan.mjs and environment.mjs's own comments).
 *
 * Built once, lazily: 16 templates x 2 languages is 32 reads, and only if
 * something actually asks.
 */
let shippedTexts = null;
function allShippedTemplateTexts() {
  if (shippedTexts === null) {
    shippedTexts = new Set();
    for (const name of TEMPLATE_WHITELIST) {
      for (const lang of SUPPORTED_LANGS) shippedTexts.add(readTemplate(name, lang));
    }
  }
  return shippedTexts;
}

/**
 * True when `rel` is a real, filled-in artefact rather than an unfilled
 * placeholder — the distinction ROADMAP#4 says the scorers were missing.
 *
 * Deliberately NOT "exclude anything under templates/": that would
 * special-case one directory name and leave the general problem (a
 * placeholder counting as content) untouched, which is exactly the fix
 * ROADMAP#4 rules out. Both rules here are about the file's CONTENT, so a
 * repository keeping placeholders anywhere — templates/, docs/, examples/,
 * the root — is judged the same way.
 *
 * `ctx` is a scan.mjs scan context; only `ctx.read` is used.
 */
export function isFilledArtifact(ctx, rel) {
  const text = ctx.read(rel);
  if (text === null) return false;
  if (FILL_MARKER.test(text)) return false;
  if (allShippedTemplateTexts().has(text)) return false;
  return true;
}
