# Goal Loop

A goal loop repeats maker -> checker -> (pass? stop : retry) until the
checker's rubric passes or a hard limit is hit. Use this when there is a
single, checkable target state -- a failing test now passes, a gap in
`assess`'s report closes -- rather than an open-ended amount of work.

## Stop condition

- The checker judges the output against `evaluator-rubric.md`'s pass
  criteria and it genuinely passes -- not "looks done", an actual green
  result from `verify --run`.
- <!-- FILL: the specific target state for this loop, e.g. "assess reports
  feedback >= 3" or "feature X's status is done in feature_list.json". -->

## Budget cap

- Max iterations: <!-- FILL: a concrete number, e.g. 10 -->.
- Wall-clock cap: <!-- FILL: e.g. 30 minutes -->.
- On hitting either cap without passing, stop and hand off via
  `session-handoff.md` rather than silently continuing past the limit.
