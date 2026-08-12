/**
 * Hard safety boundary (spec 7.2). This is the only thing standing between
 * a command declared in *someone else's repository's* AGENTS.md — read by
 * neither this tool's author nor its user — and an actual `spawn` call in
 * Task 18's `verify --run`. Matching happens on the raw command string
 * before anything is spawned; there is no "start the process, then decide"
 * variant of this that is safe.
 *
 * Design stance carried through every decision below: a false positive
 * costs the user one `--allow` flag. A false negative can be
 * unrecoverable (wiped disk, force-pushed history, a machine that just
 * rebooted mid-task). Every regex here is written to fail closed.
 *
 * Second adversarial review round (fix base 34d3c08) found 16 real commands
 * that walked straight through the first version, all traced to two
 * further structural root causes beyond the trailing-`\b` bug below:
 *
 *   1. Rules shaped `\bTOOL\s+SUBCOMMAND\b` assumed the subcommand sits
 *      immediately after the tool name. `git -C <path> push`, `kubectl -n
 *      <ns> delete`, `docker --context <ctx> system prune`, and
 *      `dd bs=4M if=...` are standard everyday usage, not obfuscation — a
 *      global flag between the tool and its subcommand is completely
 *      ordinary. Every rule of this shape now uses `\bTOOL\b[^;&|]*\b...`
 *      instead: the gap between tool and subcommand can be anything except
 *      a shell separator (`;`, `&`, `|`), so the match still can't cross
 *      into a different piped/chained command (`git status | grep push`
 *      stays unblocked). This *does* introduce new false positives — the
 *      subcommand word can now appear anywhere in the same shell segment,
 *      including inside an unrelated flag value or a quoted commit message
 *      (`git log --grep=push`, `git commit -m "add push support"`) — which
 *      is a consciously accepted trade (one `--allow` flag vs. a missed
 *      force-push), not a side effect. See task-16-report.md's round-2
 *      section for the full list of rules this applies to and why.
 *   2. Quoting and backslash-escaping defeat a literal-token match without
 *      changing what the shell actually runs: `"rm" -rf /`, `'rm' -rf /`,
 *      and `r\m -rf /` all invoke the real `rm` binary, but none of them
 *      contain the literal substring `rm ` (space-terminated) the old
 *      regex needed. `normalizeForMatching` below strips exactly the
 *      characters that hide a token this way while leaving shell semantics
 *      that matter (like backslash-space, which prevents a space from
 *      being an argument separator) alone; `checkCommand` matches against
 *      both the raw and the normalized string.
 */

// Every pattern below is written to avoid a specific class of bug: a
// trailing `\b` placed right after a quantified group whose match boundary
// is ambiguous under backtracking. `\b` only asserts a word/non-word
// transition at *whatever position the engine actually stopped at* — if
// every backtracking path that lets the rest of the pattern succeed happens
// to land on a word/word (or non-word/non-word) transition, the `\b` never
// holds and the whole match silently fails, even though a human reading the
// regex would expect it to match. Two rules shipped with exactly this bug
// (see disk-write and git-destructive below); the fix in both cases is the
// same: drop the trailing `\b` and let the alternative's own literal ending
// do the boundary work, or use a negative lookahead that names exactly
// which continuation characters disqualify a match instead of relying on
// `\b`'s coarser transition test.
export const DANGEROUS_PATTERNS = [
  // sudo must be checked before destructive-rm: "sudo rm -r x" is expected
  // (by this module's own tests, and by Task 18's contract) to report
  // 'sudo', not 'destructive-rm' — order in this array is what decides
  // which id gets reported when a command matches more than one pattern.
  // sudo is also the most fundamental hard rule: escalating to root doesn't
  // just do one dangerous thing, it removes every other permission check
  // that would have stopped a *different* dangerous thing.
  {
    id: 'sudo',
    re: /\bsudo\b/,
    reasonKey: 'safety.sudo',
    hard: true,
  },
  // Originally `\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]` (plan's own regex,
  // already correct for short flags). Extended here to also catch GNU
  // long-form `--recursive`/`--force`, which are exactly as destructive as
  // `-r`/`-f` but were not matched at all by the short-flag-only version —
  // `rm --recursive --force /` sailed straight through undetected
  // (verified empirically before this fix; see task-16-report.md). The
  // repeated prefix group now accepts either a short flag (`-[a-zA-Z]*`) or
  // a long flag (`--[a-zA-Z][a-zA-Z-]*`) followed by whitespace, and the
  // terminal alternative adds `--recursive`/`--force` alongside the
  // existing short-flag-ending-in-r-or-f case. The long-flag alternatives
  // use a negative lookahead `(?![a-zA-Z-])` rather than `\b`, because `\b`
  // would also hold at the hyphen in "--force-something-fake" (word 'e' to
  // non-word '-' is a boundary) and wrongly block an unrelated made-up
  // flag; the lookahead instead demands the flag name actually ends here.
  {
    id: 'destructive-rm',
    re: /\brm\s+(?:(?:-[a-zA-Z]*|--[a-zA-Z][a-zA-Z-]*)\s+)*(?:-[a-zA-Z]*[rf]|--recursive(?![a-zA-Z-])|--force(?![a-zA-Z-]))/,
    reasonKey: 'safety.destructive-rm',
    hard: true,
  },
  // A genuinely different concept from destructive-rm, not just another
  // spelling of it (per round-2 review guidance: new id, not folded into
  // an existing one) — `find ... -delete` and `find ... -exec rm ...`
  // don't involve a bare `rm` invocation at all, so nothing above would
  // ever catch `find / -delete`. Same severity class as destructive-rm
  // (a loose search path deletes an entire subtree in one command, no
  // undo), hence `hard: true`. Uses the same `\bTOOL\b[^;&|]*\b...` shape
  // as the round-2 tool/subcommand fixes below, since `find`'s dangerous
  // flag is just as commonly separated from `find` itself by a path and
  // other predicates (`find / -type f -delete`).
  {
    id: 'find-delete',
    re: /\bfind\b[^;&|]*(-delete\b|-exec\s+rm\b)/,
    reasonKey: 'safety.find-delete',
    hard: true,
  },
  // Round-1 (`\bmkfs\b|\bdd\s+if=|>\s*\/dev\/(sd|nvme|disk)`) already fixed
  // the trailing-`\b` bug — see the file-level comment. Round-2 review
  // found two further gaps in the same rule, both fixed here:
  //
  //  - `dd\s+if=` required `if=` immediately after `dd`, so
  //    `dd bs=4M if=/dev/zero of=/dev/sda status=progress` (a completely
  //    ordinary way to write a `dd` invocation — flags before `if=` are
  //    ubiquitous) and `dd of=/dev/sda if=/dev/zero` (if= present but not
  //    first) both slipped through. Rather than loosening to
  //    `\bdd\b[^;&|]*\bif=` (which would still miss `dd of=/dev/sda` with
  //    no `if=` at all, e.g. reading from stdin via
  //    `cat image.img | dd of=/dev/sda`), this drops the `if=` requirement
  //    entirely: bare `\bdd\b`. There is no legitimate use of a shell
  //    token literally named `dd` in a verification/build/test command
  //    that isn't raw block-level copying, so requiring a specific
  //    argument to be present bought precision this rule doesn't need and
  //    cost the coverage above. `\b...\b` still correctly excludes
  //    `ddtrace-run`, `add if=x`, and `./cmd/ddl` (checked below).
  //  - Writing to a raw block device via `cp` or `tee` instead of `dd`/`>`
  //    wasn't covered at all (`cp /dev/zero /dev/sda`, `cp image.iso
  //    /dev/sdb`, `tee /dev/sda`). Added `\b(cp|tee)\b[^;&|]*\/dev\/(sd|
  //    nvme|disk)` — deliberately doesn't distinguish source vs.
  //    destination position (cp's destination is usually, but not always
  //    provably from a regex, the last argument), so `cp /dev/sda
  //    backup.img` — a legitimate disk-image *read* — also blocks. Over-
  //    blocking is the accepted direction here: unattended reads of a raw
  //    device are unusual enough to warrant a human look too.
  {
    id: 'disk-write',
    re: /\bmkfs\b|\bdd\b|>\s*\/dev\/(sd|nvme|disk)|>\s*\/etc\/(passwd|shadow|sudoers)(?![\w.-])|\b(cp|tee)\b[^;&|]*\/dev\/(sd|nvme|disk)/,
    reasonKey: 'safety.disk-write',
    hard: true,
  },
  {
    id: 'power',
    re: /\b(shutdown|reboot|halt|poweroff)\b/,
    reasonKey: 'safety.power',
    hard: false,
  },
  // Round-2: `\bgit\s+push\b` required `push` immediately after `git`, so
  // `git -C /path push` (an everyday way to run git against a repo that
  // isn't the cwd) walked straight through. Loosened to
  // `\bgit\b[^;&|]*\bpush\b` — see the file-level comment for the accepted
  // false-positive trade this shape carries (the word "push" can now
  // appear anywhere in the same git invocation before a shell separator,
  // including a commit message: `git commit -m "add push support"` now
  // also blocks). `[^;&|]*` can never cross `;`, `&`, or `|`, so
  // `git status | grep push` still doesn't block.
  {
    id: 'git-push',
    re: /\bgit\b[^;&|]*\bpush\b/,
    reasonKey: 'safety.git-push',
    hard: false,
  },
  // Round-1 fixed the trailing-`\b` bug (see file-level comment: "git
  // clean -fdx" silently failed to match). Round-2 found the same
  // tool/subcommand-adjacency gap as git-push: `git -C /path reset --hard`
  // and `git -C /path clean -fdx` slipped past `\bgit\s+(reset...)`.
  // Loosened `git` -> subcommand the same way. Deliberately *not* loosened
  // further inside each alternative (`reset` -> `--hard`, `clean` ->
  // its flags): those are subcommand-internal option pairs, not
  // tool-level global flags, and `git reset --hard` / `git clean -f...`
  // are always written adjacently in practice. Also added `--force` as a
  // long-form alternative to `clean`'s short flags (`git clean --force`
  // is valid GNU-style long-form and wasn't matched by
  // `-[a-zA-Z]*[fd]`), the same long-form gap already fixed for
  // destructive-rm in round 1 — found while re-touching this rule, not
  // part of the review's 16 leaks, but the identical bug class.
  {
    id: 'git-destructive',
    re: /\bgit\b[^;&|]*\b(reset\s+--hard\b|clean\s+(?:-[a-zA-Z]*[fd]|--force(?![a-zA-Z-]))|filter-branch\b)/,
    reasonKey: 'safety.git-destructive',
    hard: false,
  },
  // Round-2: `docker --context remote system prune -af` slipped past
  // `\bdocker\s+(system\s+prune|...)`. Loosened `docker` -> subcommand;
  // left `system` -> `prune` and `volume` -> `rm` adjacent, since those
  // are two-word Docker subcommands where nothing can legally sit between
  // the words (`docker system prune` is the whole subcommand name, not a
  // tool name plus a separately-flagged subcommand).
  {
    id: 'container-prune',
    re: /\bdocker\b[^;&|]*\b(system\s+prune|volume\s+rm)\b/,
    reasonKey: 'safety.container-prune',
    hard: false,
  },
  // Round-2: `kubectl -n staging delete deployment x` slipped past
  // `\bkubectl\s+delete\b` for the same reason as git-push/git-destructive
  // above — `-n <namespace>` is completely ordinary kubectl usage, not an
  // edge case.
  {
    id: 'k8s-delete',
    re: /\bkubectl\b[^;&|]*\bdelete\b/,
    reasonKey: 'safety.k8s-delete',
    hard: false,
  },
  // Not in the review's 16 leaks, but the same root cause applies equally:
  // `terraform -chdir=infra apply` and `helm --kube-context prod upgrade`
  // are both standard usage that the original `\bterraform\s+apply\b`-
  // shaped regex would have missed. Fixed proactively rather than waiting
  // for a third round to find it by example.
  {
    id: 'iac-apply',
    re: /\b(terraform\b[^;&|]*\b(apply|destroy)|helm\b[^;&|]*\b(upgrade|delete|uninstall))\b/,
    reasonKey: 'safety.iac-apply',
    hard: false,
  },
  // Same proactive fix as iac-apply above: `npm --registry=<url> publish`
  // and `cargo +nightly publish` (a real, common way to pin a toolchain
  // for one invocation) are ordinary usage the original adjacency-based
  // regex would have missed. `gh`'s two-word subcommand (`release create`)
  // is left adjacent for the same reason as container-prune's `system
  // prune` / `volume rm`.
  {
    id: 'publish',
    re: /\b(npm\b[^;&|]*\bpublish|twine\b[^;&|]*\bupload|cargo\b[^;&|]*\bpublish|gh\b[^;&|]*\brelease\s+create)\b/,
    reasonKey: 'safety.publish',
    hard: false,
  },
  // Round-2: only `sh` and `bash` were covered; `curl ... | zsh` and
  // `curl ... | dash` both pipe a remote download into a real shell just
  // as effectively and weren't matched. `zsh` = "z"+"sh", `dash` =
  // "da"+"sh" (and, for the same free defense-in-depth, `ksh` = "k"+"sh",
  // `fish` = "fi"+"sh") — generalized the optional prefix rather than
  // listing full shell names, since they all end in the literal "sh" the
  // rule already anchors on.
  {
    id: 'pipe-to-shell',
    re: /(curl|wget)[^|]*\|\s*(sudo\s+)?(ba|z|da|k|fi)?sh\b/,
    reasonKey: 'safety.pipe-to-shell',
    hard: false,
  },
  // Deliberately the broadest rule in the list — see reasonKey text for the
  // full rationale (brief section D requires this to be stated explicitly
  // to the user, not just implied by the code). Kept last so a command that
  // also matches a more specific rule (e.g. "npm publish" also containing
  // "release" nowhere, but hypothetically "terraform apply for prod")
  // reports the more actionable, specific id first.
  {
    id: 'deploy-words',
    re: /\b(deploy|prod|production|release)\b/i,
    reasonKey: 'safety.deploy-words',
    hard: false,
  },
];

// Not part of DANGEROUS_PATTERNS: the empty-command case isn't a dangerous
// *pattern* match (there is no command to run at all), so it doesn't belong
// in the array the "pattern ids are unique / every pattern has a re"
// invariant is checked against. It still needs a reason text a caller can
// look up by patternId, which reasonKeyFor below provides uniformly for
// both cases.
const EMPTY_PATTERN_ID = 'empty';
const EMPTY_REASON_KEY = 'safety.empty';

// Round-2 review, root cause 2: quoting and escaping defeat a literal-token
// match without changing what actually runs. `"rm" -rf /`, `'rm' -rf /`,
// and `r\m -rf /` all invoke the real `rm` binary — confirmed against a
// real bash with a shadow `rm` on PATH — but none contain the literal
// substring `rm ` (space-terminated) `destructive-rm`'s regex looks for,
// because a quote or backslash character sits between the letters and the
// whitespace. Stripping quote characters unconditionally is safe: shell
// quoting doesn't change *which* command runs, only how its arguments are
// tokenized, and this module only cares about the former.
//
// Backslash is subtler and is *not* stripped unconditionally, because
// `\` means two different things depending on what follows it:
//   - Before a non-whitespace character (`r\m`), it just removes that
//     character's special meaning — the shell treats `\m` as a literal
//     `m`, so `r\m` tokenizes as the two-character word `rm`. Stripping
//     the backslash here reproduces exactly what the shell does.
//   - Before whitespace (`rm\ -rf`), it does the opposite of nothing:
//     it *prevents* that whitespace from being an argument separator, so
//     `rm\ -rf` is a single word ("rm -rf", with a literal embedded
//     space) followed by a second argument `/` — and no binary is named
//     "rm -rf", so this is genuinely harmless (confirmed: bash reports
//     "command not found"). Stripping the backslash here would be wrong:
//     it would turn a harmless command into what looks like `rm -rf /`
//     with `rm` and `-rf` as separate arguments, which is not what the
//     shell actually does.
// So only a backslash immediately followed by a non-whitespace character
// is removed.
function normalizeForMatching(cmd) {
  return cmd.replace(/['"]/g, '').replace(/\\(?=\S)/g, '');
}

/**
 * Resolve any patternId `checkCommand` can ever return — including the
 * `'empty'` sentinel, which has no entry in `DANGEROUS_PATTERNS` — to its
 * i18n reason key. Returns null for an id that isn't recognized, rather
 * than throwing, so a caller can defensively check before calling `t()`.
 */
export function reasonKeyFor(patternId) {
  if (patternId === EMPTY_PATTERN_ID) return EMPTY_REASON_KEY;
  return DANGEROUS_PATTERNS.find((p) => p.id === patternId)?.reasonKey ?? null;
}

/** Whether `--allow` is even eligible to override this rule. See checkCommand. */
export function isHardRule(patternId) {
  return DANGEROUS_PATTERNS.find((p) => p.id === patternId)?.hard === true;
}

/**
 * Decide whether `cmd` may be executed.
 *
 * Return shape (deliberately richer than the plan's `{blocked, patternId}`
 * — see task-16-report.md section C for the full reasoning):
 *   - `blocked`: true iff the command must not run.
 *   - `patternId`: the id of the rule currently blocking it, or the
 *     `'empty'` sentinel for blank input; null whenever blocked is false.
 *   - `overriddenBy`: the id of the rule that *would* have blocked this
 *     command had an `--allow` pattern not matched it; null otherwise. This
 *     is what lets Task 18's verify report "this would have been blocked by
 *     X, but you explicitly allowed it" instead of the override silently
 *     erasing which rule was in play.
 *
 * Matching runs against both `cmd` as given and a normalized copy (quotes
 * and hiding-backslashes stripped — see `normalizeForMatching`), so a
 * command that only matches after normalization is still blocked; the
 * reported `patternId` is the same rule id either way, since which of the
 * two strings tripped it isn't something a caller needs to act on
 * differently.
 *
 * `--allow` can only unblock a *soft* rule (`hard: false`). The four hard
 * rules — sudo, destructive-rm, find-delete, disk-write — stay blocked
 * even if an `--allow` pattern matches the exact command: their failure
 * mode is irreversible, whole-machine damage (root escalation, an unrecoverable
 * delete, a wiped disk or a locked-out account), a class of risk this
 * module's whole premise is that no single CLI flag typed ahead of time —
 * possibly written broadly, possibly matching more than the one command the
 * user actually had in mind — should be able to wave through unattended.
 * If someone genuinely needs to run one of those, they run it themselves,
 * outside the harness's automated command-execution path, where they are
 * actually watching it happen.
 *
 * `allowPatterns` should not carry the `g` flag either, for the same
 * lastIndex-mutation reason DANGEROUS_PATTERNS avoids it — this function
 * doesn't control what the caller passes in, but a stale `lastIndex` on an
 * allow regex can only make an override wrongly *not* apply (command stays
 * blocked), never wrongly let a dangerous command through, so it's a
 * caller-side correctness concern rather than a safety one.
 */
export function checkCommand(cmd, allowPatterns = []) {
  if (typeof cmd !== 'string' || cmd.trim() === '') {
    return { blocked: true, patternId: EMPTY_PATTERN_ID, overriddenBy: null };
  }

  const hit = DANGEROUS_PATTERNS.find((p) => p.re.test(cmd))
    ?? DANGEROUS_PATTERNS.find((p) => p.re.test(normalizeForMatching(cmd)));
  if (!hit) return { blocked: false, patternId: null, overriddenBy: null };

  const allowed = allowPatterns.some((re) => re.test(cmd));
  if (allowed && !hit.hard) {
    return { blocked: false, patternId: null, overriddenBy: hit.id };
  }
  return { blocked: true, patternId: hit.id, overriddenBy: null };
}
