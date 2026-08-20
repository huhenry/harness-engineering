---
name: harness-verify
description: Use when about to claim that work in a repository is complete, fixed, or passing, or when a repository declares verification commands that nobody has actually run yet — runs them for real and reports exit codes instead of trusting a claim.
---

# Harness Verify

Turn "it should work" into a real exit code.

## When to use

- Before reporting that a task, fix, or feature is done.
- When a repository declares verification commands (`harness.config.json`, or bootstrap/test/lint/typecheck/e2e/smoke commands parsed out of AGENTS.md/CLAUDE.md) and nobody has actually run them yet.
- When `harness-assess` reports "No verify evidence found" and a subsystem score shows `capped — run verify --run for evidence`.

## When not to use

- On a repository the user has not vetted — `--run` executes whatever that repository declares, and this module is a safety net against accidents, not a sandbox against a determined adversary (see Limitations below).
- To debug a failing test. Reading a stack trace and fixing code is ordinary debugging, not verification — verification is proving whether the fix actually worked.
- To edit the target repository so a check passes. That defeats the entire point of evidence.

## Workflow

1. Locate the scripts. This is the same three-way check every harness-* skill that wraps a script needs. Read step 2's command below and see which of these it is:
   - **It already names a real absolute path** (not a braced `CLAUDE_PLUGIN_ROOT` placeholder) → the scripts are under that path; run the command exactly as written. Two installs produce this. As an installed Claude Code plugin — the primary distribution path, see `.claude-plugin/marketplace.json` — Claude Code replaces the braced `CLAUDE_PLUGIN_ROOT` placeholder inside the skill's own markdown with the plugin's real root directory, where `scripts/` and `skills/` sit side by side; that is a text substitution performed when the skill is loaded, not a shell environment variable, and only the braced form is ever substituted. `install.sh` does the same job at install time, writing the source checkout's absolute path into the copy it installs and printing the path it used. If that path turns out not to exist, the checkout it was bound to has moved or been deleted — treat it as the third case below.
   - **It still shows the placeholder, and you are working inside a checkout of the harness-engineering repository itself** (for example, running its own test suite, or Task 24's self-assessment) → the same script sits at `scripts/verify.mjs`, relative to the repo root.
   - **Neither** → the skill text was copied by hand rather than installed by either path above, or an `install.sh` install's checkout is gone. `scripts/` is never copied next to the skill text by any install, so nothing here resolves on its own. Ask the user for the path to a harness-engineering checkout, or point them at https://github.com/huhenry/harness-engineering. Do not guess a path.
2. Show what would run, without running it:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" <repo>` (or `node scripts/verify.mjs <repo>` from a repo checkout).
3. Read the plan aloud to the user, including anything marked `blocked`.
4. Confirm the user trusts this repository, then execute:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs" <repo> --run`
5. Quote every command's exit code in your reply.
6. If anything failed, report the failure — do not retry silently, and never edit the target repository's code to make a check pass while verifying.

## Reading the output

| status | meaning | actually executed? |
|---|---|---|
| `planned` | dry-run only; would have run under `--run` | No |
| `blocked` | matched the safety blocklist; refused before execution, in every mode | No |
| `passed` | exit code 0 | Yes |
| `failed` | non-zero exit code | Yes |
| `timeout` | killed after the timeout elapsed | Yes |

Never read `blocked` or `planned` as a failure: both mean the command was never executed, so neither one is evidence that anything is broken — reading either as an observed failure inverts this project's own "absent evidence != negative evidence" rule and reports this tool's own decision back to the user as if it were their bug.

`--run` writes `.harness/verify-report.json` under the target repo, and creates `.harness/.gitignore` the first time so it never gets committed by accident (the report embeds real stdout/stderr, which routinely contains tokens or internal hostnames). `harness-assess` reads that file and only credits it as evidence for 24 hours — a stale report reads the same as no report at all.

### Overriding a soft block

Use `node ... --allow '<regex>'` (repeatable) to let a *soft*-blocked command through, and tell the user you are doing it — the report's "Commands you explicitly allowed past a safety rule" section will call it out too. The `deploy-words` rule blocks any command containing the whole word `deploy`, `prod`, `production`, or `release`, matched at a word boundary, case-insensitive — not a substring match. `prod-check` is blocked (word boundary holds); `releases/list` and `deployment.yaml` are not blocked (`releases` is not the word `release`, `deployment` is not the word `deploy`); `npm run deploy` is blocked.

## Hard rules

- Never claim a repository passes without an exit code. Quote the exit code for every command.
- `--run` executes commands declared by the target repository. Only use it on repositories the user trusts. Say so before running.
- Never edit the target repository's code to make a check pass while verifying.
- `--allow` can never override the four hard rules — `sudo`, `destructive-rm`, `find-delete`, `disk-write` — no matter what pattern is supplied. Their failure mode is irreversible (root escalation, an unrecoverable delete, a wiped disk), so this module refuses to let any pre-typed flag wave one through unattended. If a command genuinely needs one of these, the user runs it themselves, outside this tool, watching it happen.

## Limitations

This module is a safety net against accidents and obvious hazards, not a sandbox against a
determined adversary. It statically matches a command string with regexes and lightweight token
scans; it never runs a real shell parser, and it cannot know what a command actually does once
the shell itself expands variables, substitutes command output, or otherwise resolves indirection
at runtime.

Seven rounds of adversarial review closed a real, growing list of gaps — tool/subcommand
adjacency, separators and whitespace hidden inside quotes, a normalization pass's own performance
blowup, line continuations, argument-order permutation, path-prefixed binaries, and shell
indirection at both the payload and the binary-name level. Each fix measurably shrank the space
of commands this module gets wrong. But the underlying approach has a hard ceiling: anything this
module's logic has not specifically been taught to recognize will get through, because there is
no bound on how a shell command can be constructed to defeat a fixed set of checks. Two gaps are
left deliberately, not because they were missed: ANSI-C quoting (`$'r'$'m'` reconstructs `rm` one
escaped character at a time, with no substring any pattern here ever sees as "rm"), and shell
expansion used anywhere beyond the single binary-position check this module now performs (a value
assembled across several variable assignments and combined only at the last moment, for
instance).

Treat a clean result from this module as "no known accidental or unsophisticated-adversarial
pattern was found" — not as "this command is safe to run unattended." The actual safety boundary
is the combination of this blocklist plus `--allow`: the blocklist catches what a human might not
think to check for, and `--allow` is where informed human judgment is supposed to enter. If a
command comes from a source you don't trust, a green result here is not a substitute for reading
it yourself.
