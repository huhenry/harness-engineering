/**
 * Walk rungs bottom-up. Score is the highest rung whose checks all pass;
 * gaps from every failing check at any rung are reported so users see the
 * full picture instead of one gap at a time.
 */
export function ladder(rungs) {
  let score = 0;
  let stopped = false;
  const gapIds = [];
  for (const rung of rungs) {
    const failures = rung.checks.filter((c) => !c.ok);
    for (const f of failures) if (!gapIds.includes(f.gapId)) gapIds.push(f.gapId);
    if (failures.length === 0 && !stopped) score = rung.score;
    else stopped = true;
  }
  return { score, gapIds };
}
