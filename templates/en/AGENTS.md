# <!-- FILL: project name -->

<!-- FILL: one paragraph on what this project does and who it is for -->

## Stack

<!-- FILL: every major runtime, framework and service, WITH exact versions,
e.g. "Go 1.23, PostgreSQL 16, Redis 7". A version-less stack line is one an
agent cannot trust and will silently write code against whatever version it
remembers from training instead. -->

## Setup

```bash
./init.sh
```

`init.sh` should be the only command a clean checkout needs before anything
else in this file works. Once it installs real dependencies, run
`make check` (wraps `make test` and `make lint`) to confirm the environment
is actually usable, not just installed.

## Verification

Run these before claiming any work is done. Evidence means an exit code of
0 that you actually observed, not a sentence like "I ran the tests" in a
chat message. Leave this section's commands as shell comments until they
are real: an uncommented placeholder here would be read as a real command
and executed as one.

```bash
# FILL: replace with your real test command, e.g. go test ./...
# FILL: replace with your real lint command, e.g. golangci-lint run
```

Once these are real commands, also add them to `harness.config.json`'s
`verify` block, then run `verify --run` to turn the declaration into
evidence `assess` can read back.

## Constraints

- Never commit secrets, credentials, `.env` files, or anything under
  `.harness/` (it holds raw command output from `verify --run`; see its own
  `.gitignore`).
- Never force-push, `rm -rf`, or run another destructive git/filesystem
  command without a human watching. `.claude/settings.json`'s
  `permissions.deny` lists a few representative examples, not the complete
  set this tool refuses to run automatically.
- <!-- FILL: any other hard rule specific to this project -- forbidden
  files, required patterns, non-negotiables. -->

## Session lifecycle

At session start, read `PROGRESS.md` and `feature_list.json` before
touching any code -- they are the source of truth for what is already done
and what is next.

At session end, update both files, write `session-handoff.md` for whoever
picks this up next, and walk `clean-state-checklist.md` before ending the
session.

## Where details live

<!-- FILL: point at deeper docs once they exist -- an architecture doc, a
runbook, a design system. Until then, this file is the whole story. -->
