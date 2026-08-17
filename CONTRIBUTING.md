# Contributing

This project's whole argument is "don't claim things without evidence." That applies to
contributions too: a PR description that says "tests pass" is not evidence — a pasted `node --test`
run is.

## Hard constraints

- **Node stdlib only, zero dependencies.** No `package.json` `dependencies`, no `node_modules` in
  the shipped tool. If a task seems to need a third-party package, it doesn't — find the stdlib way
  or ask first.
- **ESM.** `"type": "module"` throughout; use `import`/`export`, not `require`.
- **Node >= 20.** Declared in `package.json`'s `engines` field; don't rely on a newer API without
  checking it exists in 20.

## Running the tests

```bash
node --test                      # full suite, no path argument
node --test tests/docs.test.mjs  # a single file
```

Two things will break the suite in ways that are easy to miss:

- **Never pass a directory to `node --test`.** `node --test tests` fails with `MODULE_NOT_FOUND` on
  Node 22 — pass no path at all (runs everything under `tests/` automatically) or an explicit list
  of files.
- **Never use a glob like `tests/**/*.mjs`.** Same reasoning — pass nothing, or explicit filenames.

If you create a temp directory in a test, use the file's own `tempRepo()`/`tempDir()` helper (every
`tests/*.mjs` file that creates one defines it the same way, with an `after()` hook that removes
it) rather than a bare `mkdtempSync`. This project's test suite once leaked 1157 temp directories
into `$TMPDIR` before this convention was enforced — see `ad3ac81`. A project about engineering
discipline should not litter the machine it runs on.

## TDD

Write the failing test first, run it, read the failure, then write the code that makes it pass —
in that order, every time. "I wrote the code, then wrote a test that happens to pass" is not TDD
and skips the one thing TDD actually verifies: that the test can fail for the right reason.

If you're fixing a bug, write a test that reproduces it (RED), then fix it (GREEN). If you're
adding a scorer rule, a safety pattern, or a template, add the test that would have caught its
absence before writing the implementation.

## Safety-sensitive changes

`scripts/lib/safety.mjs` is the one file in this project where a subtle regex bug has a
catastrophic failure mode (an unattended `rm -rf` that should have been blocked). Seven rounds of
adversarial review went into its current rule set — read the file-level comment before touching it,
it documents exactly which shapes of bypass each rule closes and why. If you're adding or changing
a rule:

- State which shell-syntax edge case it's meant to catch, with a concrete example command.
- Add a test for both the case it should block and a legitimate-looking command it should not.
- If the rule is a hard rule (cannot be overridden by `--allow`), justify why its failure mode is
  irreversible enough to deserve that — see the file's own reasoning for the existing four
  (`sudo`, `destructive-rm`, `find-delete`, `disk-write`).

## Documentation changes

Every sentence describing what a tool *does* must be something you actually ran and observed, not
something that reads plausibly. This is the same rule the tool enforces on the repositories it
assesses, and this project fails its own audit if the README ever says something the code doesn't
back up. This is not hypothetical: the first draft of this README described the command blocklist
as matching any command *containing* `deploy` or `prod`, when the rule is actually word-bounded
(`prod-check` is blocked, `deployment.yaml` is not), and described `--allow` as able to release any
blocked command, when four rules can never be overridden. Both were caught by running the code
rather than re-reading the prose.

`tests/docs.test.mjs` cross-checks the reference docs against the live rubric
(`scripts/lib/rubric.mjs`, `scripts/lib/level.mjs`) and the live safety rules
(`scripts/lib/safety.mjs`) — if you change a gap id, a level gate, or a safety rule, the
corresponding doc test should fail until the prose catches up.

If you're changing Chinese-language docs or templates, match the standard already set by
`templates/zh/**` and the `zh` block of `scripts/lib/i18n.mjs` — native technical Chinese, not a
sentence-by-sentence translation of the English.

## Before opening a PR

```bash
node --test
```

Confirm the full suite is green and the count hasn't dropped. Paste the actual output in the PR
description — this project does not accept "should be fine" as evidence, including in its own
contribution process.
