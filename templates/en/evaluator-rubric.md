# Evaluator Rubric

The checker in a maker-checker loop should judge every maker output against
this rubric, not its own ad hoc judgment -- the whole point of maker-checker
is that the check is repeatable and does not silently drift between
iterations.

## Pass criteria

- Every verification command declared in `harness.config.json` that applies
  to this change exits 0, and `verify --run` was actually invoked to prove
  it (not just claimed in prose).
- <!-- FILL: the specific, testable conditions that make this iteration's
  output acceptable, e.g. "the failing test named in feature_list.json now
  passes" or "no new gap appears in assess's output". -->

## Fail criteria

- Any declared verification command fails, or was never actually run.
- A change claims to be done without exit-code evidence to back it up.
- <!-- FILL: any project-specific reason an otherwise-passing change should
  still be rejected. -->

On a fail, the loop should route back to the maker with the specific
failure, not a vague "try again" -- see `loop/maker-checker-loop.md` for how
the two roles hand off.
