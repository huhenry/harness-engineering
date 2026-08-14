import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertLang } from './i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

/**
 * The only relative paths `scaffold` (Task 20) is ever allowed to write into
 * a target repository -- this is the entire surface area this project ever
 * touches in a stranger's checkout. Every entry here must have a matching
 * `templates/en/<name>` and `templates/zh/<name>` file (see
 * tests/templates.test.mjs's "every whitelisted template exists" test), and
 * must line up exactly with every `GAPS[].templates` reference in
 * rubric.mjs (see that same test file's "every scaffoldable gap references
 * only whitelisted templates" test) -- a hand-synced duplicate of this list
 * living in rubric.mjs was considered and rejected for the same reason this
 * codebase already keeps VERIFY_STATUS's isExecutedStatus, CI_WORKFLOW_GLOBS
 * and CONTAINER_FILES as single sources of truth rather than parallel lists.
 */
export const TEMPLATE_WHITELIST = [
  'AGENTS.md', 'CLAUDE.md', 'PROGRESS.md',
  'feature_list.json', 'feature_list.schema.json', 'harness.config.json',
  'init.sh', 'session-handoff.md', 'clean-state-checklist.md', 'evaluator-rubric.md',
  'Makefile', '.claude/settings.json', '.devcontainer/devcontainer.json',
  'loop/goal-loop.md', 'loop/timer-loop.md', 'loop/maker-checker-loop.md',
];

/**
 * Resolve a whitelisted template's absolute path for a given language.
 *
 * task-19-brief.md section B3 (measured by the controller against the
 * plan's own skeleton before dispatch): the plan's `templatePath` checked
 * `name` against `TEMPLATE_WHITELIST` but joined `lang` straight into the
 * path with no validation at all -- `templatePath('AGENTS.md',
 * '../../../etc')` resolved to a path outside `templates/` entirely, and
 * Task 20's `scaffold` is going to pass a user-supplied `--lang` flag
 * straight through to this function. Fixed by routing `lang` through
 * i18n.mjs's own `assertLang` rather than writing a second, hand-rolled
 * check here -- this project has already been bitten more than once by two
 * copies of validation logic quietly drifting apart (see safety.mjs and
 * verify-status.mjs's own header comments), and `assertLang` already throws
 * exactly the right shape of error (`CliError`, exit code 2) for a CLI
 * caller like `scaffold` to propagate untouched.
 */
export function templatePath(name, lang) {
  if (!TEMPLATE_WHITELIST.includes(name)) throw new Error(`Not a whitelisted template: ${name}`);
  assertLang(lang);
  return join(ROOT, lang, name);
}

/** Read a whitelisted template's contents. Throws the same way
 * `templatePath` does for an unknown name or unsupported language. */
export function readTemplate(name, lang) {
  return readFileSync(templatePath(name, lang), 'utf8');
}
