export const SEVERITY_WEIGHT = { high: 5, medium: 3, low: 1 };
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Deterministic ROI in 1..10. `effort` is hard-coded per gap in rubric.mjs
 * so the same repository always produces the same ordering.
 */
export function computeRoi(gapDef, currentScore) {
  const raw = (SEVERITY_WEIGHT[gapDef.severity] * (4 - currentScore)) / gapDef.effort;
  return Math.min(10, Math.max(1, Math.round(raw)));
}

/** Sort a copy of the gap list: roi desc, severity desc, id asc. */
export function sortGaps(gaps) {
  return [...gaps].sort((a, b) =>
    b.roi - a.roi ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
