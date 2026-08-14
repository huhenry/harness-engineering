# Maker-Checker Loop

Two roles, never the same agent instance: a maker proposes a change, an
independent checker judges it against `evaluator-rubric.md`. Splitting
these prevents the single biggest failure mode of an unsupervised loop --
an agent grading its own work.

## Maker

- Reads `feature_list.json` and `PROGRESS.md`, picks the next item, and
  makes the smallest change that could plausibly satisfy it.
- Runs the declared verification commands itself before handing off --
  handing off a change that has never even been run wastes the checker's
  turn on something the maker could have caught.
- Hands off with a clear description of what changed and why, not just a
  diff.

## Checker

- Judges the maker's output only against `evaluator-rubric.md` -- never its
  own ad hoc opinion, or the loop drifts between iterations.
- Actually runs `verify --run` (or reads a fresh, valid
  `.harness/verify-report.json`) rather than trusting the maker's claim
  that it passed.
- On pass, the loop stops or advances to the next item. On fail, it routes
  back to the maker with the specific reason -- not a vague "try again".

## Rollback

- Every maker iteration happens on its own commit (or branch), so a failed
  check has something concrete to roll back to -- `git revert`, not a
  hand-edited fix-forward.
- <!-- FILL: this project's actual rollback mechanism if it is not plain
  git -- a database migration's down-script, a feature flag, a snapshot. -->
- A rollback is itself verified the same way a forward change is: the
  declared commands must pass on the rolled-back state too.
