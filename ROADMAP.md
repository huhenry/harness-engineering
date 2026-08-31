# Roadmap

This is not a wishlist. Every item below is a real thing found and deliberately deferred during
this project's own development — not scope invented after the fact to pad this document. Each
entry says what was found, how it was verified, and why it was not fixed in v1.

v1.1 shipped all four candidates that used to be tracked in this section: the placeholder rule,
render-time gap suppression, the shared `MAX_SCORE` constant, and `install.sh` path substitution.
One of them shipped narrower than the item it closed, and the remainder is recorded below rather
than deleted with the item. The larger directions after that come from the project's original
design document.

## Still open from v1.1

- **An unfilled template still counts as content almost everywhere.** The placeholder rule
  (`scripts/lib/placeholder.mjs`) is wired into exactly one check: the rung-4 handoff artefacts in
  `scripts/lib/scorers/state.mjs`. `instructions`, `tools`, `loop` and the other three rungs of
  `state` still credit a file that says of itself that it is a placeholder. Measured directly by
  running `scaffold --apply` into an empty directory and then `assess` on it: **12/24, with Tools
  4/4 and Loop 4/4** — both earned entirely by files nobody has read. `templates/en/Makefile`'s own
  opening lines say "Every target below is a placeholder until the FILL lines are replaced"; all
  three `loop/*.md` templates and `evaluator-rubric.md` carry `FILL:` markers; `PROGRESS.md` and
  `feature_list.json` carry State to 3/4 the same way. This is not a regression — it is the state
  of the world before v1.1, which was scoped to the handoff rung — but closing it is a real change
  to what "exists" means across several scorers, not one more call to `isFilledArtifact`: every
  fixture score and this repository's own self-assessment would have to be re-derived from it.
  `instructions.unfilled-template` is the natural first step, and it is its own task: a new gap id,
  bilingual copy, a `references/rubric.md` row in both languages, and a new fixture.

- **`scaffold` can close the Loop entry-point rung with an unfilled placeholder.** A specific,
  measured instance of the item above, recorded separately because it is a rung `scaffold` closes
  rather than one a user vendors. `loop.no-entrypoint` deliberately carries no templates, but that
  does not keep `scaffold` away from the rung: `loop.no-maker-checker` writes
  `loop/maker-checker-loop.md`, and the mere existence of a file under `loop/` satisfies rung 2's
  entry-point check. Measured on a repository whose `AGENTS.md` mentions an autonomous loop and
  nothing else — `Loop 1/4` before `scaffold --apply`, **`Loop 2/4` after**, with the file that
  bought the rung still carrying an unreplaced `FILL:` marker. Nothing about that repository
  actually runs a loop. Fixing it properly means the entry-point check learning the difference
  between a document that declares where a loop lives and a trigger that starts one — the same
  "what does *exists* mean" change as the item above, not a special case.

- **Suppression has no severity dimension.** `presupposedBy` (`scripts/lib/rubric.mjs`) lets a
  `low`-severity gap suppress `high`-severity ones, and it is not hypothetical: `loop.none` (low)
  suppresses both `loop.no-stop-condition` and `loop.no-budget-cap` (high) today, verified directly
  by running `assess` against `fixtures/bad-repo`. v1.1 shipped a disclosure rather than a cure —
  `suppressedHighNote` (`scripts/lib/report.mjs`) now prints how many high-severity gaps a report is
  hiding and names every gap that implies them, so a report with an exit code of 1 and no visible
  high-severity finding no longer reads as a contradiction. The cure was not taken because the
  obvious one makes things worse: never letting a gap suppress one of higher severity would
  un-suppress `loop.no-stop-condition` and `loop.no-budget-cap` beside `loop.none` again on that
  same fixture, reintroducing the exact "a gap presupposes an artefact another gap just said does
  not exist" contradiction this milestone's suppression mechanism exists to remove. If a severity
  rule is ever added to `presupposedBy`, the disclosure line should be revisited rather than left
  standing beside it — they are alternative treatments of the same fact, not a pair that both belong
  in the shipped report.

- **`loop.no-entrypoint` has no permanent fixture.** The gap id v1.1 added for a loop that is
  described in prose but never wired to anything that runs it (`scripts/lib/scorers/loop.mjs`'s
  rung 2) is exercised only by unit tests in `tests/scorers/loop.test.mjs` that build the repository
  in memory, one `files: {...}` object at a time. None of the three committed fixtures reach that
  state — verified by reading `fixtures/good-repo`, `fixtures/mid-repo` and `fixtures/bad-repo`
  directly, none of their doc files (`AGENTS.md`/`CLAUDE.md`/`README.md`) contain a loop keyword at
  all, so none of them even clear rung 1, let alone land on rung 2 with no entry point. Both
  reproductions used while developing the fix (`3709854`) were hand-built temp-directory repos, torn
  down at the end of the run, never committed. A fifth fixture — an `AGENTS.md` describing an
  autonomous loop with no `loop/` directory, no scheduled workflow, and no `harness.config.json`
  `loop` field — would make the `loop.none` / `loop.no-entrypoint` split regression-proof the same
  way the other three fixtures already cover the rest of the ladder.

- **`suppressedHighNote` calls `allGaps` twice per render.** `scripts/lib/report.mjs`'s
  `suppressedHighNote` calls `allGaps(report)` once to filter for hidden high-severity gaps and a
  second time to build the id-to-title map used to name them in the disclosure line. Negligible at
  the current rubric size — 6 subsystems, 39 gaps, one render per `assess` invocation — so left as
  is. Recorded only in case the rubric grows an order of magnitude and this stops being free.

## Beyond v1.1 — larger directions

These come from the project's original design document, which lives outside this repository
(planning documents for open-source repos are kept in a sibling directory by project convention,
so they are deliberately not part of a checkout). They are directions rather than scheduled work,
one of them — the GitHub Action — shipped in
v1.2 and is struck through below. v1.3's distribution-profile foundation is recorded the same
way; the broader graph runtime remains open.

- ~~**Harness-distribution-aware assessment.** Recognize reusable skills, agent roles, and workflow
  definitions without pretending they are root-repository proof.~~ **Shipped in v1.3.** The explicit
  `harness-distribution` profile discovers root and nested harness bundles and can resolve Loop
  diagnostics only. Scores, evidence caps, totals, and levels remain byte-for-byte equivalent to
  the default `repository` profile; reports carry the profile, and cross-profile diffs are refused.
  The clean-room `fixtures/albert-shaped` repository locks in both the positive recognition and the
  root-gap boundary. This is the assessment foundation for graph engineering, not a DAG runner or
  multi-agent execution engine.

- **Graph engineering.** Multi-agent orchestration: defining a DAG of agent steps, and acceptance
  criteria for the graph as a whole rather than for one agent at a time. The Loop subsystem in this
  tool is the single-agent case of that idea.
- **More stack detectors.** Rust, Java, Swift, and embedded PlatformIO. The detector table in
  `scripts/lib/stack.mjs` is designed to be extended by adding a signature, not by editing scoring
  logic — a new stack should not require touching any scorer.
- ~~**A GitHub Action.** A marketplace action that comments the harness score delta on a pull
  request, turning the assessment into a review-time signal instead of something someone remembers
  to run.~~ **Shipped in v1.2.** `action.yml` at the repository root, running the committed
  `scripts/action.mjs` on `node24` with no dependencies and no build step; this repository runs it
  against its own pull requests in `.github/workflows/harness-diff.yml`. See the README's Action
  section for inputs, the `fetch-depth: 0` requirement, and the fork limitation. What is
  deliberately *not* done: publishing a Marketplace listing, which needs a release tag this
  repository does not have yet.
- **A web dashboard.** Assessment results across many repositories in one view.

## Other minor items noted during development (not v1.1 candidates, informational)

These were logged as non-blocking during earlier tasks and re-verified directly against the current
code while writing this document. They are listed for transparency, not because they're queued for
a release.

- **`PRUNE_DIRS` / `DEFAULT_IGNORE` remain two hand-synced lists.** `scripts/lib/scan.mjs:7` and
  `:10` define `DEFAULT_IGNORE` (glob patterns) and `PRUNE_DIRS` (a `Set` of bare directory names)
  separately; editing one without the other could silently reintroduce a directory-walk leak.
  Verified still present by reading the file directly. Noted as a minor risk since Task 4; the same
  underlying class of hand-synced-list drift as the `MAX_SCORE` duplication fixed in v1.1, but this
  one was not folded into that fix and remains open.
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

The "unfilled template" check's byte-identity rule has a ceiling of the same kind: a CRLF checkout,
a trailing-newline difference, a one-character edit, or a template body that changed between
versions all defeat it, and in an install that ships `scripts/` without `templates/` it silently
becomes a no-op. Written up in full in
[`references/rubric.md`](references/rubric.md#what-the-unfilled-template-check-does-not-catch),
next to the rule it qualifies, rather than repeated here.
