![Harness Level](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/huhenry/harness-engineering/main/harness-badge.json)

# harness-engineering

Assess, scaffold, and evidence-verify AI coding agent harnesses — a zero-dependency Node CLI that
scores a repository against a six-subsystem rubric, fills in the missing pieces, and then actually
*runs* the verification commands it finds instead of trusting that they exist.

[中文说明](README.zh-CN.md)

## Why

The upstream inspiration for this project is [`harness-creator`](#credits)-style tooling: point it
at a repository, and it tells you what a well-built AI-agent harness would look like there —
instructions, tools, environment, state, feedback, loop. That's valuable, and this project reuses
the same six-subsystem shape. But that class of tool can only ever *say* which verification
commands a repository should declare. It cannot tell you whether they actually work.

This project's one hard difference: `verify --run` actually spawns the commands a repository
declares (in `harness.config.json`, or parsed out of `AGENTS.md`/`CLAUDE.md`) and records their
real exit codes to `.harness/verify-report.json`. `assess` then reads that file, and — this is the
part that matters — **Feedback cannot reach a score of 3, and the repository cannot reach L4
"Evidence-backed," on a declared command alone.** Something has to have actually run, and its exit
code has to have actually been captured, within the last 24 hours, or the report says so plainly
instead of quietly crediting a claim nobody backed up.

That's the whole argument, and it's also why this README holds itself to the same rule: every
sentence below that describes what a command does has actually been run once while writing this
file, not written from what seemed plausible. Where useful, the real output is pasted in below.

## Install

There are two install paths, and **they are not equivalent** — pick based on what you need.

**Claude Code plugin (recommended — works out of the box, and stays working if the checkout
moves).** Add this repository as a marketplace source and install the `harness-engineering` plugin
(see `.claude-plugin/marketplace.json`). Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` inside each
skill's own markdown with the plugin's real install path, so every `harness-*` skill's documented
command resolves immediately — no extra setup step.

**`install.sh` (skill text only, bound to this one checkout).** Running `./install.sh` from a
checkout copies the skill markdown under `skills/` into whichever agent-ecosystem directory it finds
in the current project (`.claude/skills`, `.cursor/skills`, `.codex/skills`, `.gemini/skills`,
`.agent/skills`; defaults to `.claude/skills` if none exist), and substitutes this checkout's own
absolute path for `${CLAUDE_PLUGIN_ROOT}` inside every installed `SKILL.md`, so the installed
commands resolve immediately too. Its own output says plainly what it does and doesn't do:

```
$ sh install.sh
-> .claude/skills
installed harness-engineering skills
Commands in the installed skills point at this checkout:
  <checkout>
Move or delete that directory and the installed skills stop working.
(scripts/ itself is never copied -- only skill text, with this
checkout's path substituted in.)
For a relocatable install, use the Claude Code plugin instead:
  https://github.com/huhenry/harness-engineering
```

This trades one limitation for another. Installed commands now work immediately instead of asking
you for a checkout path — but they are bound to **this specific checkout's location**: move or
delete it and every command an installed skill documents breaks. It still **never copies `scripts/`**
anywhere near the installed skill text; only the absolute path to this checkout's own copy of it
gets substituted in, so `scripts/` itself has to keep existing exactly where it is. If you expect to
move, rename, or delete this checkout later, use the plugin path instead. If you just want to try
the CLI directly, skip both install paths and clone the repository — every command below runs
straight from a checkout with `node scripts/<name>.mjs`.

## Quick start

Three commands, run against this repository's own fixtures so the output below is real:

```
$ node scripts/assess.mjs fixtures/bad-repo
# Harness Assessment Report

Score: 0 / 24

Level: L0 Ad-hoc

Evidence: No verify evidence found — run `verify --run` to generate `.harness/verify-report.json`.

## Subsystem Scores

| Subsystem | Score | Status |
| --- | --- | --- |
| Instructions | 0/4 |  |
| Tools | 0/4 |  |
...
### Feedback · No declared verification commands (ROI 10)

- Why: Without a declared, machine-readable command list, both the agent and any automated verifier have to guess which commands are the real checks.
- Fix: Add a harness.config.json declaring the canonical test, build and lint commands.
...
```

```
$ node scripts/scaffold.mjs <repo>
# Harness Scaffold

Mode: dry-run — nothing below was actually written. Re-run with --apply to write it.

## Planned files

| Action | Target | Gap |
| --- | --- | --- |
| create (no existing file) | `harness.config.json` | feedback.no-declared-commands |
| create (no existing file) | `AGENTS.md` | instructions.missing |
| create (no existing file) | `PROGRESS.md` | state.no-progress |
...
```

Dry-run by default — nothing is written until you re-run with `--apply`.

```
$ node scripts/verify.mjs <repo> --run
# Verify Report

Mode: run — the commands below were actually executed.

Result: PASSED

## Commands

| Role | Command | Status |
| --- | --- | --- |
| test | `echo all good` | passed |

Evidence written to <repo>/.harness/verify-report.json
```

Run `assess` again after `verify --run` and watch Feedback (and, once a bootstrap command is
declared, Environment) move from `capped — run verify --run for evidence` to a real score backed by
a real exit code.

## Comparing two assessments: `harness diff`

`assess --json`'s output is a stable, versioned document (`schemaVersion`). Save two of them —
before a change and after it, or from two branches — and `diff.mjs` turns the difference into a
pass/fail signal a CI job can gate on, instead of a human re-reading two markdown reports side by
side:

```
$ node scripts/assess.mjs fixtures/bad-repo  --json --out /tmp/h-before.json
$ node scripts/assess.mjs fixtures/good-repo --json --out /tmp/h-after.json
$ node scripts/diff.mjs /tmp/h-before.json /tmp/h-after.json
# Harness Diff Report

Score: 0 → 16 (+16)

Level: L0 → L3 (+3)

## Subsystem Scores

| Subsystem | Before → After | Delta |
| --- | --- | --- |
| Instructions | 0 → 4 | +4 |
| Tools | 0 → 3 | +3 |
| Environment | 0 → 3 | +3 |
| State | 0 → 4 | +4 |
| Feedback | 0 → 2 | +2 |
| Loop | 0 → 0 | 0 |

## Fixed

- No declared verification commands (high)
- No AGENTS.md or CLAUDE.md (high)
- No progress file (high)
...
```

Comparing the same two reports in the other direction is a real regression, and exits `1`:

```
$ node scripts/diff.mjs /tmp/h-after.json /tmp/h-before.json; echo "exit=$?"
...
exit=1
```

`--json` emits the same `DiffResult` document, machine-readable: `schemaVersion`, `before`/`after`/
`delta` for total score and level, `regression` and `regressionReasons` (`total`, `level`, or
`subsystem:<id>`, never gap *count* — a tool upgrade that ships a new gap id would otherwise look
identical to a repository actually regressing), per-subsystem deltas in rubric order, and
`gaps.fixed`/`gaps.introduced` by id. `--out FILE` writes the report there instead of stdout, and
prints nothing to stdout at all. A `schemaVersion` mismatch between the two input files is refused
with exit `2` rather than silently compared — two reports built under different schema versions can
carry fields that mean different things under the same key, and this project would rather refuse
than answer with a number that merely looks plausible.

## On every pull request: the GitHub Action

`action.yml` at the root of this repository is a GitHub Action. It assesses the head of a pull
request, assesses its base commit, and posts the difference as a comment — the same markdown
`diff.mjs` prints above, so what a reviewer reads on the pull request is byte-for-byte what you
get locally.

```yaml
name: harness-diff
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0            # required — see below
      - uses: huhenry/harness-engineering@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`@main` because this repository has no release tag yet. Pinning a third-party action to a moving
branch is a supply-chain risk you should not accept as a habit — pin to a tag or a commit sha as
soon as there is one to pin to.

Zero dependencies here too: no `@actions/core`, no `@actions/github`, no bundle, no build step,
and no `setup-node` step. `action.yml` selects GitHub's `node24` JavaScript-action runtime and the
runner executes the committed `scripts/action.mjs` directly, so the code you can read in this
repository is exactly the code that runs on your pull request. Self-hosted runners must be new
enough to support Node 24 actions.

| Input | Default | What it does |
| --- | --- | --- |
| `repo-path` | `.` | Directory to assess. The same subtree is exported from the base commit, so both sides always describe the same thing. |
| `base-ref` | `${{ github.event.pull_request.base.sha }}` | The commit to compare against. |
| `fail-on-regression` | `false` | Whether a regression fails the step. See below. |
| `comment` | `true` | Whether to post (or update) a pull request comment. |
| `lang` | `en` | Language of the comment: `en` or `zh`. |

Outputs: `score-before`, `score-after`, `score-delta`, `level-before`, `level-after`, and
`regression`. Exit codes follow the same convention as the CLIs above — `1` only ever means an
opted-in regression, never a failed comment.

### `fetch-depth: 0` is required

The base side comes from `git archive <base-sha>`, unpacked into a temporary directory outside
your repository. That is a pure read: unlike a second `actions/checkout` or a `git worktree add`,
it writes nothing into your workspace and nothing into `.git/`, which is what lets this project
keep promising that `assess` is read-only and that the Action never writes the repository it is
assessing.

The cost is that the base commit has to actually be present in `.git`, and `actions/checkout`
defaults to `fetch-depth: 1`, which does not fetch it. When that happens the action stops and
names `fetch-depth: 0` in the error, rather than passing along a bare `fatal: not a valid object
name` and leaving you to guess.

### Pull requests from forks do not get a comment

GitHub gives a workflow triggered by a fork's pull request a read-only `GITHUB_TOKEN` regardless
of what `permissions:` asks for. Posting returns 403, the action logs a warning, and the step
still succeeds. The diff is written to the job summary and the job log, so the result is visible
either way — just not as a comment.

The usual workaround is `pull_request_target`, which runs with a writable token in the context of
the base repository while checking out the fork's code. Don't. That is a well-known way to hand
an attacker who opens a pull request write access to your repository, and a comment is not worth
it. This project would rather state the limitation than paper over it.

### `fail-on-regression` defaults to `false`

Deliberately. The first thing anyone does with a new check is find out what it says about their
repository, and they cannot do that while it is blocking their merge queue. A check that turns
red on the day it is installed gets uninstalled, not investigated. Turn it on once you have seen
how the score behaves on your own history, or leave it off and gate on the `regression` output
yourself. This repository sets it to `true` for its own pull requests
(`.github/workflows/harness-diff.yml`) — a decision it is entitled to make about itself, and not
one it makes for you.

### One comment, edited in place

Every comment opens with a hidden `<!-- harness-engineering-diff -->` marker. Before posting, the
action looks for a comment whose *first line* is that marker and `PATCH`es it instead of adding
another. Only the first line counts, so quoting the comment back in a reply does not make the
next run start editing your message. A fresh comment on every push is how a useful bot becomes a
muted bot.

### The one thing the comparison cannot see

`git archive` exports tracked files only, so the base side can never contain
`.harness/verify-report.json` — this tool's own verify evidence is deliberately never committed.
If an earlier step in the same job ran `verify --run`, the head side has evidence the base side
structurally cannot, and Feedback and Environment will show an improvement nobody made. The
action detects that asymmetry and warns about it. Run it *before* any `verify --run` step and
both sides are evidence-free, which is a fair comparison.

## Exit codes

These are a stable interface — this project's own CI gates on them, and the first command above
deliberately exits `1` because `fixtures/bad-repo` is a repository with real high-severity gaps.
A non-zero exit here means "the repository has a problem", not "the tool broke".

| Code | `assess` | `verify` | `scaffold` | `diff` | the Action |
| --- | --- | --- | --- | --- | --- |
| `0` | `--min-level` met, or no high-severity gaps when no level was requested | every command passed (dry-run: every command was planned) | dry-run, or `--apply` wrote everything it planned | comparison succeeded, no regression | ran to completion; a comment that could not be posted is a warning, not a failure |
| `1` | `--min-level` not met, or high-severity gaps found | any command failed, timed out, or was blocked | a write failed, or a template was missing | comparison succeeded, but a regression was found (score, level, or a subsystem moved backwards) | `fail-on-regression` is on and a real regression was found |
| `2` | usage error (a bad flag or value) | usage error | usage error | usage error (bad flag, missing file, unparseable JSON, wrong argument count, or a `schemaVersion` mismatch) | usage error (an input value that is not a YAML boolean, an unsupported `lang`, an empty `base-ref`, or a `base-ref` that is not in `.git`) |
| `3` | unexpected internal error | unexpected internal error | unexpected internal error | unexpected internal error | unexpected internal error |

`2` and `3` are deliberately distinct: a mistyped flag and a crash in the tool should never be
indistinguishable to a script, and neither should be confused with `1`, which is a successful run
reporting a real result about your repository.

## The six subsystems

| Subsystem | What it checks |
| --- | --- |
| `instructions` | Can an agent starting cold learn the stack, setup, constraints, and how to verify its own work? |
| `tools` | Is there one canonical build/test/run entrypoint, with a documented allow/deny line? |
| `environment` | Can the environment be reproduced deterministically — pinned deps, pinned runtime, a working bootstrap? |
| `state` | Can a new or resumed session tell what's already done without re-deriving it? |
| `feedback` | When something is claimed to work, is there a real, machine-checkable, *actually-run* signal backing it? |
| `loop` | If this repo runs unattended, does the loop have a stop condition, a budget cap, and a checker? |

Each scores `0`–`4` (`24` total). Full per-score criteria and all 39 gap ids:
[`references/rubric.md`](references/rubric.md).

## Levels

Levels are **gated**, not derived from the total score — a high total with one weak subsystem does
not buy a higher level.

| Level | Name | Gate |
| --- | --- | --- |
| L0 | Ad-hoc | (default) |
| L1 | Instructed | `instructions >= 2` |
| L2 | Reproducible | + `environment >= 2` and `tools >= 2` |
| L3 | Continuous | + `state >= 3` |
| L4 | Evidence-backed | + `feedback >= 3` **and** a fresh, valid `verify --run` evidence file |
| L5 | Loop-ready | + `loop >= 3` and every subsystem `>= 3` |

## Safety

`verify --run` **executes the commands** your repository declares in `harness.config.json` or
parsed out of `AGENTS.md`/`CLAUDE.md`. Only run it on repositories you trust — this is a safety net
against accidents, not a sandbox against a determined adversary (see the full
[Limitations statement](skills/harness-verify/SKILL.md#limitations)).

Before spawning anything, every command is checked against a blocklist in `scripts/lib/safety.mjs`.
The rule most readers assume works differently than it actually does is `deploy-words`: it is a
**word-boundary** match, not a substring match, on `deploy`, `prod`, `production`, or `release`
(case-insensitive). `prod-check` is blocked (word boundary holds); `releases/list` and
`deployment.yaml` are **not** blocked (`releases` is not the word `release`, `deployment` is not
the word `deploy`).

`--allow '<regex>'` lets a *soft*-blocked command through deliberately. It **can never override the
four hard rules** — `sudo`, `destructive-rm`, `find-delete`, `disk-write` — no matter what pattern
is supplied, because their failure mode is irreversible (root escalation, an unrecoverable delete, a
wiped disk) and no pre-typed flag should be able to wave one through unattended:

```
$ node scripts/verify.mjs <repo> --run --allow '.*'
...
| bootstrap | `rm -rf /` | blocked (refused before execution) |
...
- `bootstrap` (`rm -rf /`): ... This is a hard rule: `--allow` cannot override it.
```

Treat a clean result from this module as "no known accidental or unsophisticated-adversarial
pattern was found" — not as "this command is safe to run unattended." See
[`skills/harness-verify/SKILL.md`](skills/harness-verify/SKILL.md#limitations) for the full,
adversarially-reviewed limitations statement, including the two gaps left deliberately open.

## Credits

The six-subsystem shape and the level ladder in this project are an implementation of the ideas
taught in [*Learn Harness Engineering*](https://walkinglabs.github.io/learn-harness-engineering/en/)
— go there for the full argument in prose. [`references/failure-modes.md`](references/failure-modes.md)
maps the course's own failure modes, lecture by lecture, onto the specific gap id in this tool that
checks for each one.

## License

MIT — see [`LICENSE`](LICENSE).
