# Roadmap

This is not a wishlist. Every item below is a real thing found and deliberately deferred during
this project's own development — not scope invented after the fact to pad this document. Each
entry says what was found, how it was verified, and why it was not fixed in v1.

The v1.1 candidates were each re-verified against the current code before being listed, so the
file and line references below are accurate as of this release rather than as of when the item was
first noticed. The larger directions at the end come from the project's original design document.

## v1.1 candidates

### 2. A shared `MAX_SCORE` constant

**What's wrong:** The top rung of every subsystem's score (`4`) is a duplicated literal, not a
single source of truth. Confirmed directly by reading the code:

- `scripts/lib/report.mjs:48` and `:64` each independently write `max: 4` / `SUBSYSTEMS.length * 4`.
- Every one of the six scorers (`scripts/lib/scorers/{instructions,tools,environment,state,
  feedback,loop}.mjs`) hardcodes its own top rung as `{ score: 4, checks: [...] }` inside its
  `ladder([...])` call — six more independent copies of the same "4" with no shared constant behind
  any of them.

**Why not fixed in v1:** This project has already been bitten four times by hand-synced parallel
lists drifting apart (see e.g. `PRUNE_DIRS`/`DEFAULT_IGNORE` under "Other minor items" below, and the
`docker.runtimePins`/`manifest` and `CONTAINER_FILES` fixes described in `environment.mjs`'s own
comments). A shared `MAX_SCORE` constant is the same class of fix, but touches `report.mjs` plus
all six scorer files — real, multi-file surface area that was correctly judged out of scope for the
task that found it (Task 14, which owned `report.mjs` only).

## Beyond v1.1 — larger directions

These come from the project's original design document, which lives outside this repository
(planning documents for open-source repos are kept in a sibling directory by project convention,
so they are deliberately not part of a checkout). They are directions rather than scheduled work,
and none of them is started.

- **Graph engineering.** Multi-agent orchestration: defining a DAG of agent steps, and acceptance
  criteria for the graph as a whole rather than for one agent at a time. The Loop subsystem in this
  tool is the single-agent case of that idea.
- **More stack detectors.** Rust, Java, Swift, and embedded PlatformIO. The detector table in
  `scripts/lib/stack.mjs` is designed to be extended by adding a signature, not by editing scoring
  logic — a new stack should not require touching any scorer.
- **`harness diff`.** Score movement between two assessments of the same repository, so a team can
  see whether their harness is improving rather than only what it scores today.
- **A GitHub Action.** A marketplace action that comments the harness score delta on a pull
  request, turning the assessment into a review-time signal instead of something someone remembers
  to run.
- **A web dashboard.** Assessment results across many repositories in one view.

## Other minor items noted during development (not v1.1 candidates, informational)

These were logged as non-blocking during earlier tasks and re-verified directly against the current
code while writing this document. They are listed for transparency, not because they're queued for
a release.

- **`PRUNE_DIRS` / `DEFAULT_IGNORE` remain two hand-synced lists.** `scripts/lib/scan.mjs:7` and
  `:10` define `DEFAULT_IGNORE` (glob patterns) and `PRUNE_DIRS` (a `Set` of bare directory names)
  separately; editing one without the other could silently reintroduce a directory-walk leak.
  Verified still present by reading the file directly. Noted as a minor risk since Task 4; not
  urgent enough to have been folded into item 2 above, but the same underlying class of risk.
- **A cosmetic inconsistency in the example fixtures.** `fixtures/good-repo/go.sum` and
  `fixtures/mid-repo/go.sum` both pin `github.com/lib/pq` with no matching `require` line in the
  corresponding `go.mod` and no import in `main.go`. Verified still present by reading both files
  directly. Harmless — these are fixtures for scoring logic, not compiled — but noted as a batch
  cleanup candidate the same way it was noted during Task 13.

## Known, deliberately-accepted limits (not roadmap items)

The safety module (`scripts/lib/safety.mjs`) has a documented, structural ceiling — not a bug
queue. See the [README's Safety section](README.md#safety) and
`skills/harness-verify/SKILL.md`'s Limitations section for the full statement. These are listed
there, not here, because the project's own conclusion after seven rounds of adversarial review was
that the right next step is disclosure, not another round of patching.
