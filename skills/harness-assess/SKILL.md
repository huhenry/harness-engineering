---
name: harness-assess
description: Use when asked to evaluate how agent-ready a repository is, score its harness against the L0-L5 rubric, or find the highest-ROI gaps to fix before agent work starts.
---

# Harness Assess

Score a repository's six harness subsystems and report exactly what is missing, in priority order.

## When to use

- "How agent-ready is this repo" / "what's missing before an agent can work here safely".
- Before scaffolding anything — establish the real baseline instead of guessing which files are missing.
- To decide what to fix next: the report's Gaps table is already sorted by ROI (highest first).
- To check whether a repository has reached a specific level (`--min-level`), e.g. as a CI gate.

## When not to use

- To actually write the missing files — that is `harness-scaffold`'s job, not this skill's.
- To confirm that declared commands actually work — that is `harness-verify`'s job. This skill only reads what has already been recorded; it never executes anything itself.
- To eyeball a repository and guess a score. See Hard rules.

## Workflow

1. Locate the scripts, same three-way check as every harness-* skill that wraps a script. Read step 2's command and see which case it is:
   - It already names a real absolute path (not a braced `CLAUDE_PLUGIN_ROOT` placeholder) → run it as written. Both an installed Claude Code plugin and an `install.sh` install produce this; `install.sh` writes the source checkout's absolute path in at install time. If that path does not exist, the checkout has moved or been deleted — treat it as the third case.
   - It still shows the placeholder, and you are working inside a harness-engineering repo checkout → `scripts/assess.mjs`, relative to the repo root.
   - Neither → the skill text was copied by hand, or an `install.sh` install's checkout is gone; no install ever copies `scripts/` next to the skill text. Ask the user for a harness-engineering checkout path, or point them at https://github.com/huhenry/harness-engineering. Do not guess a path.
2. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/assess.mjs" <repo>`
   - `--json` for machine-readable output.
   - `--min-level <0-5>` to gate on a specific level: exits 0 if reached, 1 if not, 2 if the flag value itself isn't a valid integer 0-5.
   - `--out <file>` to write the report to a file instead of stdout.
3. Quote the score, level, per-subsystem table, and Gaps-by-ROI list verbatim in your reply. Never re-derive or paraphrase the numbers.
4. If the report's Evidence line says no verify evidence was found, say so explicitly and explain the consequence (see Reading the output) — do not silently drop it.
5. For any gap the user wants fixed, hand off to `harness-scaffold` rather than writing the files yourself. For "prove this actually works", hand off to `harness-verify`.

## Reading the output

- `Score: N / 24` and `Level: L0..L5` — the level is *gated*, not a rounding of the score: each level requires every one of its conditions to hold, so a high total score does not by itself mean a high level was reached (see `level.mjs`'s gate list).
- The per-subsystem table: `capped — run verify --run for evidence` next to a score means that subsystem is being held down until real command-execution evidence exists — it is not a bug, it is the point.
- **L4 is unreachable without verify evidence.** L4 requires Feedback >= 3 *and* fresh, passing verify evidence (`.harness/verify-report.json`, valid schema, generated within the last 24 hours). Without a verify report, `hasTestEvidence` is always false, so the Feedback subsystem's rung 3 can never pass and Feedback can never exceed 2 — no matter how good the declared commands look on paper, L4 is structurally unreachable on declared commands alone. Tell the user to run `harness-verify --run` before promising L4 is in reach.
- L5 additionally requires Loop >= 3 and every subsystem >= 3.
- The Gaps-by-ROI table is already sorted, highest ROI first — read it top to bottom, don't re-sort it by eye.
- `--json` legitimately contains gaps the markdown does not, each carrying `suppressedBy: "<some other gap id>"`. Those are real failing checks that would read as a contradiction next to the gap that names them — "Progress file is stale" beside "No progress file" — so the human report hides them and the exit code still counts them. This is not a bug and not a discrepancy to report: quote the markdown's Gaps-by-ROI list, and if you are reading the JSON, treat a `suppressedBy` gap as "true, but fix the gap it points at first".

## Hard rules

- Never hand-score a repository. Always run the script and quote its output.
- Never claim a level has been reached without the tool itself saying so — `report.level.id` (or `--min-level`'s exit code) is the source of truth, not a manual read of the file tree.
