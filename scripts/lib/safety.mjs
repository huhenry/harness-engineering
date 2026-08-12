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
  // The `\bdd\s+if=|>\s*\/dev\/(sd|nvme|disk)` half is the controller's
  // corrected version: the original had a trailing `\b` after the whole
  // alternation, which for `dd if=/dev/zero of=/dev/sda` sat between `=`
  // and `/` — both non-word characters, so `\b` never held and the entire
  // match failed despite `dd if=` being right there in the string. Dropping
  // the trailing `\b` fixes it without weakening anything: `dd\s+if=` and
  // `>\s*\/dev\/(sd|nvme|disk)` are already fully specific on their own.
  // The `/etc/(passwd|shadow|sudoers)` half is an addition from this task:
  // overwriting a system auth file via a `>`/`>>` redirect is at least as
  // catastrophic as writing to a raw block device (it can lock out every
  // account, or grant one) and was not covered by the original /dev/*-only
  // destination list. It uses `(?![\w.-])` rather than `\b` for the same
  // reason as destructive-rm above: `\b` would also match `/etc/passwd.bak`
  // or `/etc/passwd-old` (word 'd' to non-word '.'/'-' is a boundary),
  // which are unrelated files that happen to share a prefix.
  {
    id: 'disk-write',
    re: /\bmkfs\b|\bdd\s+if=|>\s*\/dev\/(sd|nvme|disk)|>\s*\/etc\/(passwd|shadow|sudoers)(?![\w.-])/,
    reasonKey: 'safety.disk-write',
    hard: true,
  },
  {
    id: 'power',
    re: /\b(shutdown|reboot|halt|poweroff)\b/,
    reasonKey: 'safety.power',
    hard: false,
  },
  {
    id: 'git-push',
    re: /\bgit\s+push\b/,
    reasonKey: 'safety.git-push',
    hard: false,
  },
  // Corrected per the controller: the original wrapped the whole
  // alternation in a trailing `\b` — `\bgit\s+(...|clean\s+-[a-zA-Z]*[fd]|...)\b`.
  // For "git clean -fdx", every backtracking path through
  // `-[a-zA-Z]*[fd]` that lets the rest of the string exist ends with the
  // matched `[fd]` character immediately followed by another letter (the
  // 'x', or whatever letter `[a-zA-Z]*` gave back), i.e. a word/word
  // transition — `\b` never holds on any path, so the whole alternative
  // fails and "git clean -fdx" (a real, spec-required must-block case)
  // passed straight through. `reset\s+--hard\b` and `filter-branch\b` were
  // never broken (they end on a fixed literal, not a backtracking class),
  // so only the shared trailing `\b` — now removed — was the bug.
  {
    id: 'git-destructive',
    re: /\bgit\s+(reset\s+--hard\b|clean\s+-[a-zA-Z]*[fd]|filter-branch\b)/,
    reasonKey: 'safety.git-destructive',
    hard: false,
  },
  {
    id: 'container-prune',
    re: /\bdocker\s+(system\s+prune|volume\s+rm)\b/,
    reasonKey: 'safety.container-prune',
    hard: false,
  },
  {
    id: 'k8s-delete',
    re: /\bkubectl\s+delete\b/,
    reasonKey: 'safety.k8s-delete',
    hard: false,
  },
  {
    id: 'iac-apply',
    re: /\b(terraform\s+(apply|destroy)|helm\s+(upgrade|delete|uninstall))\b/,
    reasonKey: 'safety.iac-apply',
    hard: false,
  },
  {
    id: 'publish',
    re: /\b(npm\s+publish|twine\s+upload|cargo\s+publish|gh\s+release\s+create)\b/,
    reasonKey: 'safety.publish',
    hard: false,
  },
  {
    id: 'pipe-to-shell',
    re: /(curl|wget)[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
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
 * `--allow` can only unblock a *soft* rule (`hard: false`). The three hard
 * rules — sudo, destructive-rm, disk-write — stay blocked even if an
 * `--allow` pattern matches the exact command: their failure mode is
 * irreversible, whole-machine damage (root escalation, an unrecoverable
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

  const hit = DANGEROUS_PATTERNS.find((p) => p.re.test(cmd));
  if (!hit) return { blocked: false, patternId: null, overriddenBy: null };

  const allowed = allowPatterns.some((re) => re.test(cmd));
  if (allowed && !hit.hard) {
    return { blocked: false, patternId: null, overriddenBy: hit.id };
  }
  return { blocked: true, patternId: hit.id, overriddenBy: null };
}
