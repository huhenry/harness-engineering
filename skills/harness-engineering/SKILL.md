---
name: harness-engineering
description: Use when an AI coding agent behaves unreliably in a repository — losing context between sessions, declaring work done without evidence, overreaching scope — or when a repository has no AGENTS.md at all and needs a harness built from scratch.
---

# Harness Engineering

Route to the right harness skill. This skill never touches a repository directly.

## When to use

- An agent working in this repository loses context between sessions, or repeats work that was already finished.
- An agent (or a previous session) declared a task "done" or "passing" with no exit code backing the claim.
- An agent overreached its intended scope, or a repository has no AGENTS.md/CLAUDE.md at all.
- It is unclear which of `harness-assess`, `harness-scaffold`, `harness-verify`, or `harness-loop` actually applies yet.

## When not to use

- The right sub-skill is already obvious — invoke it directly instead of routing through here first.
- To actually run a check, write a file, or score a repository — every one of those belongs to a specific sub-skill; this one only decides which.

## Workflow

1. Match the trigger to a sub-skill:
   - "How agent-ready is this repo / what's missing / what should I fix first / has it reached level L*" → `harness-assess`.
   - "This repo has no AGENTS.md / PROGRESS.md / feature_list.json / init.sh — build the missing harness files" → `harness-scaffold`.
   - "I'm about to say this is done, fixed, or passing" / "prove these declared checks actually run" → `harness-verify`.
   - "Design or review an autonomous or scheduled loop — its stop condition, budget cap, maker-checker split, rollback path" → `harness-loop`.
2. Invoke that sub-skill directly and follow its own Workflow. Do not reimplement its steps here.
3. If more than one applies, sequence them: `harness-assess` first to establish the real baseline, then `harness-scaffold` to fill the gaps it found, then `harness-verify` to turn the fix into real exit-code evidence — in that order, since scaffold's default selection and assess's evidence-capped scoring are both meaningless without the assess step running first.

## Reading the output

This skill produces no report of its own. Whatever the user sees is the output of the sub-skill it routed to — quote that skill's own output, not a summary invented here.

## Hard rules

- Route, do not re-implement. Each sub-skill owns its own workflow.
- Never run `assess.mjs`, `scaffold.mjs`, or `verify.mjs` directly from this skill — hand off to `harness-assess`, `harness-scaffold`, or `harness-verify`, which each carry the safety rules (dry-run-first, never-overwrite, evidence-before-claims) this skill does not repeat.
