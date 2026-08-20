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

**Claude Code plugin (recommended — works out of the box).** Add this repository as a marketplace
source and install the `harness-engineering` plugin (see `.claude-plugin/marketplace.json`). Claude
Code substitutes `${CLAUDE_PLUGIN_ROOT}` inside each skill's own markdown with the plugin's real
install path, so every `harness-*` skill's documented command resolves immediately — no extra
setup step.

**`install.sh` (skill text only — needs one more step).** Running `./install.sh` from a checkout
copies the skill markdown under `skills/` into whichever agent-ecosystem directory it finds in the
current project (`.claude/skills`, `.cursor/skills`, `.codex/skills`, `.gemini/skills`,
`.agent/skills`; defaults to `.claude/skills` if none exist). Its own output says plainly what this
does and doesn't do:

```
$ sh install.sh
-> .claude/skills
installed harness-engineering skills
NOTE: this installs skill text only. scripts/ was NOT copied, and none
of these target directories give the harness-* skills a working path
to it (no $CLAUDE_PLUGIN_ROOT-equivalent variable is set here).
The installed skills will ask you for a harness-engineering checkout
path the first time a command actually needs to run. For working
commands out of the box, install this as a Claude Code plugin instead:
  https://github.com/huhenry/harness-engineering
```

It **does not copy `scripts/`** — only the skill text — and none of the five target directories,
including the default `.claude/skills`, get a `${CLAUDE_PLUGIN_ROOT}`-equivalent variable set. So
after `install.sh` runs, the installed skill has no working path to `scripts/*.mjs` and will ask
you for a checkout path the first time it actually needs to run one. This isn't a bug to be fixed
by reading harder — it's a real, current limitation of the non-plugin ecosystems, listed as a
[roadmap item](ROADMAP.md#v11-candidates) for the actual fix. If you just want to try the CLI
directly, skip both install paths and clone the repository — every command below runs straight
from a checkout with `node scripts/<name>.mjs`.

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

## Exit codes

These are a stable interface — this project's own CI gates on them, and the first command above
deliberately exits `1` because `fixtures/bad-repo` is a repository with real high-severity gaps.
A non-zero exit here means "the repository has a problem", not "the tool broke".

| Code | `assess` | `verify` | `scaffold` |
| --- | --- | --- | --- |
| `0` | `--min-level` met, or no high-severity gaps when no level was requested | every command passed (dry-run: every command was planned) | dry-run, or `--apply` wrote everything it planned |
| `1` | `--min-level` not met, or high-severity gaps found | any command failed, timed out, or was blocked | a write failed, or a template was missing |
| `2` | usage error (a bad flag or value) | usage error | usage error |
| `3` | unexpected internal error | unexpected internal error | unexpected internal error |

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

Each scores `0`–`4` (`24` total). Full per-score criteria and all 38 gap ids:
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
