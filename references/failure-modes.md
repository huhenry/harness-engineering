# Failure modes: course → gap id

[*Learn Harness Engineering*](https://walkinglabs.github.io/learn-harness-engineering/en/) is the
upstream course this tool operationalizes (see the root [README](../README.md#credits)). It
describes, in prose, the failure modes a harness is supposed to prevent. This document is the
bridge: for each lecture, the concrete failure mode it describes, and which of this tool's 37 gap
ids (`scripts/lib/rubric.mjs`) checks for it.

This maps 13 of the course's 14 lectures. Lecture 14, *From Single Loops to Graph Engineering*, was
not fetched for this document — its subject (multi-agent orchestration graphs) sits above what a
single repository's static rubric can check, and nothing below claims otherwise. Everything else in
this document was read from the live course site on 2026-08-17, not reconstructed from memory —
quotes are verbatim.

## Lecture 1 — Why Capable Agents Still Fail

Five structural failure modes, all attributed to the harness, not the model ("check the harness"
before swapping models):

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Vague requirements — "Add a search feature" leaves pagination, query type, highlighting undefined | `state.no-feature-list`, `state.feature-list-invalid` |
| Implicit conventions never written down ("the agent has no way to comply") | `instructions.missing`, `instructions.no-constraints` |
| Incomplete environment setup — context spent on "pip install errors and Node version conflicts" | `environment.no-lockfile`, `environment.no-runtime-pin`, `environment.no-bootstrap` |
| Missing verification methods — "the agent calls it done when it feels done" | `feedback.no-tests`, `feedback.no-declared-commands` |
| Cross-session state loss — "failure rates spike sharply on tasks exceeding 30 minutes" | `state.no-progress`, `state.progress-stale` |

## Lecture 2 — What a Harness Actually Is

Names a failure mode per subsystem directly:

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Tools: disabling shell access "for security reasons" — "if the agent cannot even run `pip install`, how is it supposed to get anything done?" | `tools.no-entrypoint`, `tools.no-permissions` |
| Feedback: "could not run tests" with no declared verification commands, called "the highest-ROI subsystem" | `feedback.no-declared-commands`, `feedback.no-tests` |
| Instructions: a bare README leads the agent to pick "the wrong package manager (npm vs yarn)" and violate naming conventions | `instructions.missing`, `instructions.no-constraints` |
| State: "context accumulates endlessly" without structured progress tracking, agent "loops" instead of advancing | `state.no-progress`, `state.progress-incomplete` |
| Environment: missing dependency locks and runtime pins mean the agent "cannot reproduce the baseline state" | `environment.no-lockfile`, `environment.no-runtime-pin` |

## Lecture 3 — Why the Repository Must Become the System of Record

Core claim: "information that doesn't exist in the repo, doesn't exist for the agent."

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Invisible constraints — a team where "70% of tasks required human intervention" over undocumented architectural rules | `instructions.no-constraints`, `instructions.missing` |
| "Discovery cost" — context burned searching instead of solving | `instructions.no-layering` (topic docs discoverable on demand, not buried) |
| Repeated guessing every session with no persistent map | `state.no-progress`, `state.no-handoff` |
| Stale documentation "confidently misdirect[s]" agents — "the biggest enemy" | `instructions.stale-links` |

## Lecture 4 — Why One Giant Instruction File Fails

Four failure modes, mapped almost one-to-one onto the `instructions.*` rubric:

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Context budget depletion — 10-20K tokens consumed by a bloated file | `instructions.too-long` |
| "Lost in the middle" — a constraint buried at line 300 of 600 gets ignored | `instructions.too-long`, `instructions.no-layering` |
| Priority confusion — the agent "cannot distinguish non-negotiable hard constraints from suggestive soft guidelines" | `instructions.no-constraints` |
| Maintenance decay — files only grow, signal-to-noise declines | `instructions.stale-links`, `instructions.too-long` |

Recommended fix (entry file <= 200 lines, topic docs under `docs/`, embedded doc comments) is
exactly what `instructions.no-layering` and `instructions.too-long` check for.

## Lecture 5 — Why Long-Running Tasks Lose Continuity

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Loss of decision context — new sessions see only "what" (the code), not "why" | `state.no-handoff` |
| Duplicate and conflicting work from missing progress records | `state.no-progress`, `state.progress-incomplete` |
| Implementation drift — "each new session has a slightly different understanding... each deviation compounds" | `state.no-feature-list`, `state.feature-list-invalid` |
| Verification gap — results not recorded, every session re-diagnoses from scratch | `feedback.commands-unverified` |
| "Context anxiety" near the context limit causes a rushed, unverified finish | `state.progress-incomplete`, `feedback.no-declared-commands` |

Recommended mechanisms (PROGRESS.md, decision logs, git commits as checkpoints, clock-in/clock-out
protocols) map directly onto `state.no-progress`, `state.progress-stale`, and
`state.lifecycle-undocumented`.

## Lecture 6 — Why Initialization Needs Its Own Phase

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Weak infrastructure — "the test framework is configured but never verified, lint rules are set but too loose, no progress file created" | `environment.no-bootstrap`, `feedback.commands-unverified`, `state.no-progress` |
| Unverified accumulation — feature code built on a flawed, undiscovered setup | `environment.bootstrap-fails` |
| Wasted context on setup that itself stays broken — "the worst of both worlds" | `environment.no-bootstrap` |
| Implicit assumption landmines — "the first session chose Vitest... the second session's agent doesn't know and introduces Jest" | `instructions.no-stack-versions`, `environment.no-lockfile` |

## Lecture 7 — Why Agents Overreach and Under-Finish

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Overreach — one task turns into "12 files modified, 800 lines of new code, and not a single feature works end-to-end" | `state.no-feature-list` (no externalized WIP=1 scope surface) |
| Under-finish — overreach and under-finish "amplify each other" | `feedback.no-e2e` |
| Recommendation: explicit completion evidence, not "code is written" | `feedback.commands-unverified`, `feedback.no-declared-commands` |
| Recommendation: externalized, machine-readable scope surface | `state.no-feature-list`, `state.feature-list-invalid` |

## Lecture 8 — Why Feature Lists Are Harness Primitives

The most direct one-to-one mapping in the course, onto the `state.no-feature-list` /
`state.feature-list-invalid` pair:

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Undefined completion standards — "you never told it what 'done' means, so it used its own standard" | `state.no-feature-list` |
| State inference overhead — "mostly done, still need payments" wastes ~20 minutes per session diagnosing | `state.no-feature-list` |
| Duplicate implementation from unstructured tracking | `state.feature-list-invalid` |
| Scope drift with no machine-readable artifact | `state.no-feature-list` |

## Lecture 9 — Why Agents Declare Victory Too Early

Directly names the problem `feedback.commands-unverified` / `feedback.commands-failing` exist to
catch:

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Unit test false confidence — passing mocks hide real cross-system breakage | `feedback.single-check-kind`, `feedback.no-e2e` |
| Systematic self-evaluation bias — agents "systematically provide overly positive assessments" of their own work | `loop.no-maker-checker` |
| Incomplete feature implementation — unit tests pass, migration/e2e never checked | `feedback.no-e2e` |
| Refactoring during verification "shifts the boundary between verified and unverified code" | `feedback.commands-unverified` |
| Recommendation: "the completion judgment should not be made by the agent itself" | `loop.no-maker-checker` |

## Lecture 10 — Why End-to-End Testing Changes Results

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Interface mismatch invisible to unit tests (relative vs. absolute path example) | `feedback.no-e2e` |
| State propagation errors — stale ORM cache after a schema migration | `feedback.no-e2e` |
| Resource lifecycle issues that "only appear under real load" | `feedback.no-e2e` |
| Environment dependency — code passes mocked, fails in production | `feedback.no-e2e`, `feedback.no-observability` |
| "Only end-to-end testing can prove the absence of system-level defects" | `feedback.no-e2e` |

## Lecture 11 — Why Observability Belongs Inside the Harness

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| "Looks correct" vs. "actually works" cannot be distinguished without runtime traces | `feedback.no-observability` |
| "Evaluation becomes mysticism" without scoring rubrics and acceptance criteria | `loop.no-maker-checker` |
| Blind retry cycles — the agent "might hammer away in the wrong direction" | `feedback.no-observability` |
| Handoff inefficiency — redundant diagnosis eats "30-50% of total session time" | `state.no-handoff`, `feedback.no-observability` |

## Lecture 12 — Why Every Session Must Leave a Clean State

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| "Build is broken, tests are red, temporary debug files are scattered everywhere, the feature list hasn't been updated" | `state.no-handoff`, `state.lifecycle-undocumented` |
| Entropy accumulation — inconsistent patterns compound, "a week later the table is buried under cups" | `state.lifecycle-undocumented` |
| Measured 12-week drift: build pass 100% → 68%, tests 100% → 61%, startup 5min → 60+ min, with no cleanup discipline | `state.no-handoff`, `loop.no-rollback` |
| Successor sessions spend time "inferring which parts of this code are intentional and which are temporary" | `state.no-handoff` |

## Lecture 13 — From Manual Prompting to Autonomous Loops

Maps onto the entire `loop.*` subsystem:

| Failure mode (quoted) | Gap id(s) |
| --- | --- |
| Agent drift mid-execution with no loop structure to self-correct | `loop.none` |
| Premature victory declaration without independent verification | `loop.no-maker-checker` |
| "Models forget everything between runs; memory must live on disk" | `state.no-progress` |
| No verifiable stopping condition | `loop.no-stop-condition` |
| Self-grading — "a model is its own output's best defense attorney" | `loop.no-maker-checker` |
| Token blowout — "prompt size grows roughly quadratically with the number of turns" | `loop.no-budget-cap` |
| "Fast loops tempt you to skip verification," costs "pile up" | `loop.no-rollback` |

## Coverage note

This mapping is deliberately many-to-many and sometimes approximate: the course describes failure
modes in narrative case studies, while this tool's gap ids are discrete, statically-checkable
conditions. A lecture's failure mode maps to a gap id where the rubric's check is a genuine,
static proxy for it — not a claim that passing every gap listed here reproduces the lecture's full
argument. See [rubric.md](rubric.md) for exactly what each gap id checks.
