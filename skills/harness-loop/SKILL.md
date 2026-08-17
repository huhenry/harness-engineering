---
name: harness-loop
description: Use when designing an autonomous or scheduled agent loop, or reviewing one that already exists, and its stop condition, budget cap, maker-checker role separation, or rollback path have not been pinned down yet.
---

# Harness Loop

Design (or review) an agent loop that stops on its own, on purpose, before it runs out of budget.

## When to use

- Setting up a new autonomous loop, timer loop, or maker-checker loop.
- Reviewing an existing loop that has no documented stop condition, no budget cap, no independent checker, or no rollback path.
- `harness-assess` reports the Loop subsystem at 0-2 and the user wants to close those gaps.

## When not to use

- To actually execute a loop iteration — this skill designs and reviews the loop's *shape*, it does not run anything.
- To judge whether one specific change passes or fails — that's what the loop's own checker role, and `harness-verify`, are for.
- On a one-off task with a single clear finish line and no repetition — that's ordinary task execution, not a loop.

## Workflow

1. Identify which loop pattern fits:
   - **Goal loop** — a single, checkable target state (a failing test now passes, a gap in `assess`'s report closes). Repeats maker → checker → stop-or-retry until the rubric passes or a hard limit is hit.
   - **Timer loop** — no single "done" state; wakes on a schedule (cron, a scheduled CI workflow) and does exactly one bounded unit of work per invocation, then stops and lets the next scheduled run continue.
   - **Maker-checker loop** — the role split underneath either pattern above: a maker proposes a change, a *different* agent instance judges it against a written rubric. Never the same instance grading its own work.
2. If the repository has no loop templates yet, hand off to `harness-scaffold --only loop` (or the specific gap id, e.g. `loop.none` / `loop.no-maker-checker`) to generate `loop/goal-loop.md`, `loop/timer-loop.md`, `loop/maker-checker-loop.md`, and `evaluator-rubric.md` — do not hand-author these from scratch when a template already exists.
3. Fill in, for this specific loop, in writing before it runs even once:
   - The exact stop condition (pass criteria, target state, or explicit signal — not "looks done").
   - A hard budget cap: max iterations and a wall-clock (or spend) limit, and what happens when either is hit (stop and hand off via `session-handoff.md`, never silently keep going).
   - Maker and checker as genuinely separate roles, both judged against the same written rubric (`evaluator-rubric.md`), not each agent's own ad hoc opinion.
   - A rollback mechanism the checker can actually invoke on a failed iteration (`git revert`, a snapshot restore, a feature flag) — plain "fix forward" is not a rollback path.
4. Confirm the checker's pass/fail decision is backed by real evidence — `harness-verify --run`, or a fresh `.harness/verify-report.json` — never the maker's own unverified claim that it passed.

## Reading the output

This skill produces a design, not a report from a script — there is no exit code to quote. What to check the design against instead:
- Every stop condition names a concrete, observable end state, not a vague "when it feels done".
- Every budget cap is a specific number (iterations, wall-clock minutes, or spend), not "reasonable" or "not too long".
- The maker and the checker are never the same running instance, and the checker's rubric is written down, not implicit.
- There is a real rollback path the checker can invoke, not just a plan to "be more careful next time".

## Hard rules

- Never design a loop without a stop condition and a budget cap.
- Never let the same agent instance act as both maker and checker for the same iteration.
- Never let a loop's "pass" be based on the maker's own claim — require real, run verification evidence.
