---
name: coordinator
description: Coordinate a bounded local maker-checker workflow.
---

# Coordinator

Run an autonomous loop in which a worker prepares one candidate and a verifier
reviews it independently.

- Stop condition: every declared check exits zero and the verifier accepts the
  candidate.
- Max iterations: 4. Stop without publishing when that budget is exhausted.
- Rollback: if an accepted change later fails integration, use `git revert` and
  retain the failing evidence for the next attempt.

This skill describes an installable harness component. It is not evidence that
the repository containing the bundle has root-level instructions, tests, CI, or
an executable product entrypoint.
