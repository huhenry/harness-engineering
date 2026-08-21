# Rubric reference

This is the human-readable mirror of `scripts/lib/rubric.mjs` (gap definitions) and
`scripts/lib/scorers/*.mjs` (the actual scoring logic). It is checked against the code by
`tests/docs.test.mjs`: every gap id below must exist in `GAPS`, every subsystem name must be in
`SUBSYSTEMS`, and every level below must exist in `LEVELS`. If this file and the code ever
disagree, the test goes red — this file cannot silently drift out of date the way a hand-written
doc normally would.

`node scripts/assess.mjs <repo>` runs this rubric against a real repository and prints the exact
gaps it found, in ROI order. See the root [README.md](../README.md) for a full worked example.

## The six subsystems

Every repository is scored on six independent subsystems, `0`–`4` each, `24` total:

| Subsystem | What it asks |
| --- | --- |
| `instructions` | Can an agent starting cold learn the stack, setup, constraints and how to verify its own work — without re-deriving any of it? |
| `tools` | Is there one canonical entrypoint for build/test/run, and a documented line between auto-approved and forbidden actions? |
| `environment` | Can the environment be reproduced deterministically — pinned dependencies, a pinned runtime, a bootstrap script that actually works? |
| `state` | Can a new or resumed session tell what's already done without re-deriving it from the diff? |
| `feedback` | When the agent claims something works, is there a real, machine-checkable signal backing that claim — and was it actually run? |
| `loop` | If this repository runs unattended, does the loop have a stop condition, a budget cap, and a way to check its own output? |

Scores are **gated**, not additive — see [Levels](#levels) below. A repository can score 20/24 and
still sit at L0 if `instructions` is 0, because L1 requires `instructions >= 2` specifically, not
just a high total.

## Instructions (`instructions.*`)

Scored from `AGENTS.md` or `CLAUDE.md` (in that order — whichever exists first wins).

| Score | Criterion |
| --- | --- |
| 0 | Neither `AGENTS.md` nor `CLAUDE.md` exists. |
| 1 | The file exists. |
| 2 | A line names a detected stack technology (e.g. `go`, `node`) alongside a version number, **and** a heading matches setup/install/getting-started. |
| 3 | A heading matches constraints ("never", "forbidden", ...), **and** a heading matches verification/testing, **and** the file is `<= 150` lines. |
| 4 | At least one local link points at a `.md` file inside a subdirectory (layered docs), **and** every local link target actually resolves on disk. |

Gap ids: `instructions.missing`, `instructions.no-stack-versions`, `instructions.no-setup-commands`,
`instructions.no-constraints`, `instructions.no-verification`, `instructions.too-long`,
`instructions.no-layering`, `instructions.stale-links`.

## Tools (`tools.*`)

| Score | Criterion |
| --- | --- |
| 0 | No `Makefile`, `justfile`, `Taskfile.yml`, or `package.json` with a non-empty `scripts` block. |
| 1 | One of those entrypoints exists. |
| 2 | The instructions file actually mentions invoking it (`make <target>`, `npm run`, `just ...`, `task ...`). |
| 3 | Every `make`/`just`/`task`/`npm run` reference inside the instructions file's code spans resolves to a real target, **and** a permissions file exists (`.claude/settings.json` or `.cursor/rules`). |
| 4 | The permissions file (or the instructions file) documents both an allow list and a deny list — a real least-privilege line, not just a permissions file's existence. |

Gap ids: `tools.no-entrypoint`, `tools.broken-entrypoint`, `tools.no-permissions`,
`tools.no-least-privilege-doc`.

## Environment (`environment.*`)

| Score | Criterion |
| --- | --- |
| 0 | No detected stack has a lockfile or a runtime pin present at all. |
| 1 | At least one lockfile or runtime pin exists somewhere. |
| 2 | Every lockfile-capable detected stack has its lockfile present, **and** at least one detected stack has its runtime pin present. |
| 3 | A bootstrap command is declared (`harness.config.json`'s `verify.bootstrap`, or `init.sh`/`bootstrap.sh`/`scripts/setup.sh` exists). |
| 4 | A container file exists (a Dockerfile/Compose manifest, or `.devcontainer/devcontainer.json`), **and** `verify --run`'s evidence shows the bootstrap command was actually executed and passed. Rung 4's bootstrap condition is evidence-gated: without a fresh `.harness/verify-report.json`, this rung is reported as `capped — run verify --run for evidence`, not as a hard failure. |

Gap ids: `environment.no-lockfile`, `environment.no-runtime-pin`, `environment.no-bootstrap`,
`environment.bootstrap-fails`, `environment.no-container`.

## State (`state.*`)

Progress file candidates: `PROGRESS.md`, `claude-progress.md`, `docs/PROGRESS.md`.

| Score | Criterion |
| --- | --- |
| 0 | No progress file exists. |
| 1 | A progress file exists. |
| 2 | It was modified (by git history, falling back to filesystem mtime) within the last 30 days, **and** it has headings matching done/in-progress/blocked, all three. |
| 3 | `feature_list.json` exists **and** validates (every feature has a non-empty, unique `id`, a non-empty `title`, and a `status` in `todo`/`in-progress`/`done`/`blocked`). |
| 4 | `session-handoff.md` and `clean-state-checklist.md` both exist **as filled-in files** (at any depth), **and** `AGENTS.md` documents a session-start/session-end lifecycle. A missing artefact reports `state.no-handoff`. An artefact that exists but that this tool cannot read as filled in reports `state.handoff-unfilled` instead — vendoring or scaffolding the template is not writing the document. "Not filled in" covers three states: an unreplaced `FILL:` marker; a copy that is byte-identical to one of this project's shipped templates *after* a leading `scaffold` provenance line is stripped (so a freshly scaffolded file counts, even though it is never literally byte-identical); and a file that could not be read at all. The two ids are independent: "the file is missing" and "the file exists but was never filled in" are different facts, and a repository can trip one per artefact at the same time — each gap's text names only the artefacts that actually caused it. |

Gap ids: `state.no-progress`, `state.progress-stale`, `state.progress-incomplete`,
`state.no-feature-list`, `state.feature-list-invalid`, `state.no-handoff`,
`state.handoff-unfilled`, `state.lifecycle-undocumented`.

### What the "unfilled template" check does not catch

Stated here for the same reason the [README's Safety section](../README.md#safety) states the
blocklist's ceiling: a limit disclosed is worth more than a limit implied. The check has two rules
— an unreplaced `FILL:` marker (Rule A), and byte-identity with a shipped template after a leading
`scaffold` provenance line is stripped (Rule B). Rule B is exact byte comparison, and "byte" means
byte:

- A CRLF checkout of a vendored template, a single differing trailing newline, or one edited
  character anywhere in the file, all defeat it.
- So does a template whose *body* changed between tool versions. The provenance line is matched by
  shape rather than by version number and survives a release; the body is not, and does not.
- Six of this project's markdown templates carry a `FILL:` marker, so Rule A still catches every
  case above for those. `clean-state-checklist.md` is the one handoff artefact with no marker in
  either language — for that file Rule B is the only defence, so any of the above lets an untouched
  vendored copy score as filled in.
- In an install that ships `scripts/` without `templates/` next to it (a script-only plugin cache
  copy, for example — a shape `assess` supports and is tested for), there is nothing to compare
  against: Rule B silently becomes a no-op for the whole run, with no note in the report. Rule A is
  unaffected.

Every one of these fails in the *permissive* direction: Rule B does not fire, and an untouched
template counts as a filled-in document. Read "byte-identical" as exactly that and nothing broader.
The check errs the other way in one case only — a file this tool cannot read at all is treated as
unfilled, which costs a point rather than granting one that was not earned.

## Feedback (`feedback.*`)

The highest-weighted subsystem in the rubric's ROI math, and the one this project exists to make
honest — see the root README's [Why](../README.md#why) section.

| Score | Criterion |
| --- | --- |
| 0 | No test files found anywhere in the tree. |
| 1 | Test files exist. |
| 2 | At least one verification role (`bootstrap`/`test`/`lint`/`typecheck`/`e2e`/`smoke`) is declared in `harness.config.json` or parsed from `AGENTS.md`/`CLAUDE.md`. |
| 3 | `verify --run`'s evidence shows the `test` role was actually executed (not merely declared, and not `blocked`/`planned`), it did not fail, **and** a second check kind (lint or typecheck) is declared, or passed if evidence exists. |
| 4 | e2e or smoke is declared/passing, **and** a CI workflow file exists, **and** an observability entrypoint (a declared `smoke` command, or a `healthz`/log-location mention in `AGENTS.md`) is documented. |

Rung 3 is evidence-gated the same way Environment's rung 4 is: without a fresh
`.harness/verify-report.json`, this reports `capped — run verify --run for evidence` rather than a
failure. **This is the subsystem this project's whole argument rests on**: Feedback cannot reach 3,
and the repository cannot reach L4, on a declared command alone — something has to have actually
been run and its exit code recorded.

Gap ids: `feedback.no-tests`, `feedback.no-declared-commands`, `feedback.commands-unverified`,
`feedback.commands-failing`, `feedback.single-check-kind`, `feedback.no-ci`, `feedback.no-e2e`,
`feedback.no-observability`.

## Loop (`loop.*`)

Scored from `AGENTS.md`, `CLAUDE.md`, `README.md`, and any `loop/*.md` file, concatenated.

| Score | Criterion |
| --- | --- |
| 0 | No mention of an autonomous/scheduled loop anywhere in those docs. Reports `loop.none`. |
| 1 | The docs mention a loop pattern (`autonomous`, `loop`, `cron`, `scheduled`, or the Chinese equivalents). |
| 2 | A concrete entry point exists: a scheduled CI workflow, a `loop/*.md` file, or `harness.config.json` declares a `loop` field. Failing this rung alone — a loop described in prose that nothing invokes — reports `loop.no-entrypoint`, not `loop.none`. |
| 3 | The docs describe both a stop condition and a budget cap (iteration/time/spend limit). |
| 4 | The docs describe a maker-checker split (or `evaluator-rubric.md` exists), **and** a rollback mechanism. |

Rungs 0 and 2 report **different** gap ids on purpose. "No loop pattern is described anywhere" and
"a loop is described but nothing runs it" are different facts with different fixes, and the rung-3
and rung-4 gaps below are suppressed only beneath the first: a repository that documents an
autonomous loop and never wires it up is still told, in full, that its loop has no stop condition
and no budget cap. A repository that has never mentioned a loop is told one thing.

Gap ids: `loop.none`, `loop.no-entrypoint`, `loop.no-stop-condition`, `loop.no-budget-cap`,
`loop.no-maker-checker`, `loop.no-rollback`.

## Levels

Levels are **gated**, not derived from the total score: `computeLevel()` walks bottom-up and stops
at the first unmet condition. Each level requires everything the level below it required, plus
what's listed here.

| Level | Name | Gate (in addition to every lower gate) |
| --- | --- | --- |
| L0 | Ad-hoc | (none — the default) |
| L1 | Instructed | `instructions >= 2` |
| L2 | Reproducible | `environment >= 2` and `tools >= 2` |
| L3 | Continuous | `state >= 3` |
| L4 | Evidence-backed | `feedback >= 3` **and** a fresh, valid `verify --run` evidence file exists |
| L5 | Loop-ready | `loop >= 3` **and** every one of the six subsystems is `>= 3` |

L4 is the level this project's own differentiator lives in: reaching it requires an actual
`.harness/verify-report.json` written by `verify --run`, not just a high Feedback score derived from
declared commands. See the root README's [Why](../README.md#why) section for the full argument.
