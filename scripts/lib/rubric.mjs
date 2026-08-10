export const SUBSYSTEMS = ['instructions', 'tools', 'environment', 'state', 'feedback', 'loop'];

const def = (id, severity, effort, templates = []) => ({
  id,
  subsystem: id.split('.')[0],
  severity,
  effort,
  scaffoldable: templates.length > 0,
  templates,
  titleKey: `gap.${id}.title`,
  whyKey: `gap.${id}.why`,
  fixKey: `gap.${id}.fix`,
});

export const GAPS = [
  // instructions
  def('instructions.missing', 'high', 1, ['AGENTS.md', 'CLAUDE.md']),
  def('instructions.no-stack-versions', 'high', 2),
  def('instructions.no-setup-commands', 'high', 2),
  def('instructions.no-constraints', 'medium', 2),
  def('instructions.no-verification', 'high', 2),
  def('instructions.too-long', 'medium', 2),
  def('instructions.no-layering', 'low', 2),
  def('instructions.stale-links', 'medium', 2),
  // tools
  def('tools.no-entrypoint', 'high', 3, ['Makefile']),
  def('tools.broken-entrypoint', 'high', 2),
  def('tools.no-permissions', 'medium', 2, ['.claude/settings.json']),
  def('tools.no-least-privilege-doc', 'low', 2),
  // environment
  def('environment.no-lockfile', 'high', 2),
  def('environment.no-runtime-pin', 'high', 1),
  def('environment.no-bootstrap', 'medium', 1, ['init.sh']),
  def('environment.bootstrap-fails', 'high', 3),
  def('environment.no-container', 'low', 3, ['.devcontainer/devcontainer.json']),
  // state
  def('state.no-progress', 'high', 1, ['PROGRESS.md']),
  def('state.progress-stale', 'high', 2),
  def('state.progress-incomplete', 'medium', 2),
  def('state.no-feature-list', 'medium', 1, ['feature_list.json', 'feature_list.schema.json']),
  def('state.feature-list-invalid', 'high', 2),
  def('state.no-handoff', 'low', 1, ['session-handoff.md', 'clean-state-checklist.md']),
  def('state.lifecycle-undocumented', 'medium', 2),
  // feedback
  def('feedback.no-tests', 'high', 3),
  def('feedback.no-declared-commands', 'high', 1, ['harness.config.json']),
  def('feedback.commands-unverified', 'high', 3),
  def('feedback.commands-failing', 'high', 3),
  def('feedback.single-check-kind', 'medium', 3),
  def('feedback.no-ci', 'medium', 3),
  def('feedback.no-e2e', 'medium', 3),
  def('feedback.no-observability', 'low', 2),
  // loop
  def('loop.none', 'low', 1, ['loop/goal-loop.md', 'loop/timer-loop.md', 'loop/maker-checker-loop.md']),
  def('loop.no-stop-condition', 'high', 2),
  def('loop.no-budget-cap', 'high', 2),
  def('loop.no-maker-checker', 'medium', 2, ['evaluator-rubric.md', 'loop/maker-checker-loop.md']),
  def('loop.no-rollback', 'medium', 2),
];

export function gapById(id) {
  const found = GAPS.find((g) => g.id === id);
  if (!found) throw new Error(`Unknown gap id: ${id}`);
  return found;
}

export function gapsFor(subsystem) {
  return GAPS.filter((g) => g.subsystem === subsystem);
}
