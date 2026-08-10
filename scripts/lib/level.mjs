import { SUBSYSTEMS } from './rubric.mjs';

/**
 * Gated levels: a level is reached only when every one of its conditions
 * holds. Total score is reported separately and never promotes a level.
 * Each condition carries a short label used for "what blocks the next level".
 *
 * Conditions only list what is new at that level — computeLevel() walks the
 * list bottom-up and stops at the first unmet level, so a level's own
 * conditions are only ever checked once every earlier level has already
 * passed. That walk is what encodes "L2 = L1 AND ...", "L3 = L2 AND ...", etc.
 */
export const LEVELS = [
  { id: 0, nameKey: 'level.0', conditions: [] },
  { id: 1, nameKey: 'level.1', conditions: [
    { label: 'instructions >= 2', test: (s) => s.instructions >= 2 },
  ] },
  { id: 2, nameKey: 'level.2', conditions: [
    { label: 'environment >= 2', test: (s) => s.environment >= 2 },
    { label: 'tools >= 2', test: (s) => s.tools >= 2 },
  ] },
  { id: 3, nameKey: 'level.3', conditions: [
    { label: 'state >= 3', test: (s) => s.state >= 3 },
  ] },
  { id: 4, nameKey: 'level.4', conditions: [
    { label: 'feedback >= 3', test: (s) => s.feedback >= 3 },
    { label: 'verify evidence', test: (_s, hasEvidence) => hasEvidence === true },
  ] },
  { id: 5, nameKey: 'level.5', conditions: [
    { label: 'loop >= 3', test: (s) => s.loop >= 3 },
    { label: 'all subsystems >= 3', test: (s) => SUBSYSTEMS.every((k) => s[k] >= 3) },
  ] },
];

/**
 * Walk the levels bottom-up, stopping at the first unmet gate.
 * `unmetGates` reports the conditions blocking the next level up from the
 * one reached — empty only once the top level (L5) has been reached.
 */
export function computeLevel(scores, hasEvidence) {
  let reached = LEVELS[0];
  let unmetGates = [];
  for (const level of LEVELS.slice(1)) {
    const unmet = level.conditions
      .filter((c) => !c.test(scores, hasEvidence))
      .map((c) => c.label);
    if (unmet.length > 0) {
      unmetGates = unmet;
      break;
    }
    reached = level;
  }
  return { id: reached.id, nameKey: reached.nameKey, unmetGates };
}
