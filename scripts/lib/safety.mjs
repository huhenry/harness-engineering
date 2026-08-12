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
 *      ordinary.
 *   2. Quoting and backslash-escaping defeat a literal-token match without
 *      changing what the shell actually runs: `"rm" -rf /`, `'rm' -rf /`,
 *      and `r\m -rf /` all invoke the real `rm` binary.
 *
 * Round 2 fixed both with a character class (`[^;&|]*` for the gap between
 * tool and subcommand) plus a lossy quote/backslash-stripping pre-pass
 * (`normalizeForMatching`). Third adversarial review round (fix base
 * 96f6505) found that fix itself had two further Critical problems:
 *
 *   A. A character class has no concept of quote state, so a separator
 *      character *inside quotes* still stopped the scan even though the
 *      shell treats it as ordinary argument content, not a boundary:
 *      `git -C ";" push origin main` is one real invocation (`-C`'s
 *      argument is the literal string ";"), but `[^;&|]*` can't cross the
 *      quoted `;` to reach `push`. `normalizeForMatching` didn't rescue
 *      this either — it stripped the quote *characters* but left the
 *      separator they were hiding fully intact.
 *   B. `[^;&|]*` between two anchors is evaluated once per candidate start
 *      position for the first anchor (`.test()` searches the whole
 *      string), and each attempt that fails re-scans up to the rest of the
 *      string looking for the second anchor. A string with O(n) occurrences
 *      of the first anchor and the second anchor never present — e.g.
 *      `'git '.repeat(n) + 'x'` — is therefore O(n) attempts × O(n) scan
 *      each = O(n²). Measured (this round, matching the coordinator's
 *      finding independently): 1000 reps ≈ 11ms, 2000 ≈ 42ms, 4000 ≈
 *      152ms, 8000 ≈ 612ms, 16000 ≈ 2.4s, 32000 ≈ 9.7s — textbook
 *      quadratic. Round 2's own backtracking test used a *different*
 *      adversarial shape (long filler plus one real occurrence, not many
 *      restart points with no resolution), which is why it stayed green
 *      while this was live — it measured the shape already fixed, not the
 *      shape that hurts.
 *
 * Both are fixed by replacing character-class-based scanning with an
 * actual quote-aware linear scan (`splitIntoCanonicalSegments`, below) plus
 * a hard length cap (`MAX_COMMAND_LENGTH`):
 *
 *   - Segmenting on `;`, `&`, `|`, and newline *only when they occur
 *     outside any quote* fixes (A): a quoted separator is no longer a
 *     boundary, so the rules correctly see the whole real invocation.
 *   - Segmenting alone does not fix (B): a pathological input with no real
 *     separator anywhere still produces exactly one segment as long as the
 *     whole input, and every tool/subcommand rule is still vulnerable to
 *     restart-point blowup *within* that one segment. There is no regex
 *     shape that fixes this for arbitrary adversarial input — bounding the
 *     regex engine's worst case is not a promise a regex-based rule can
 *     make. So `checkCommand` instead refuses to analyze anything over
 *     `MAX_COMMAND_LENGTH` at all: an O(1) length check replaces an
 *     unbounded regex pass, and a `harness.config.json`-declared
 *     verification command that's actually over 2048 characters is
 *     pathological by this project's own model of what a "canonical
 *     command" is (see the `too-long` pattern below).
 *
 * The same quote-aware scan also does better than round 2's lossy
 * stripping for one more thing: `normalizeForMatching` had no way to tell
 * "a quoted single word used *as* the command name" (`"rm" -rf /`) apart
 * from "one multi-word quoted *argument* that happens to contain a
 * dangerous-looking substring" (`echo "don't rm -rf things"`, `grep 'git
 * push' log.txt`) — both dequoted to the same flat text. `
 * splitIntoCanonicalSegments` keeps that distinction by replacing internal
 * whitespace *within* a quoted region with `_` instead of a real space:
 * `"don't rm -rf things"` becomes `don't_rm_-rf_things`, one fused
 * underscore-joined blob in which `rm` is no longer a `\b`-bounded word
 * (its neighbor is `_`, a `\w` character) and is no longer followed by
 * real whitespace (`\s+`-based rules need actual whitespace, and there is
 * none left inside the fused blob). A single unquoted word used as a
 * command name (`"rm" -rf /`) has no internal whitespace to fuse, so it
 * still dequotes cleanly to a real, matchable token.
 */

// A `harness.config.json`-declared verification command is meant to be a
// short, canonical, single-purpose invocation ("npm test", "go build
// ./..."), not an embedded multi-KB script — so this is a generous cap,
// not a tight one. Chosen and verified empirically (see task-16-report.md's
// round-3 section) against the actual restart-point-heavy adversarial
// shape across every tool/subcommand rule below: worst case at this length
// is ~3ms, comfortably under any threshold that would matter, with orders
// of magnitude of headroom before the quadratic curve above becomes
// noticeable at all.
const MAX_COMMAND_LENGTH = 2048;

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
//
// Every rule below is matched against each *segment* produced by
// `splitIntoCanonicalSegments`, not the raw command string — see the
// file-level comment for why. Within a segment there is by construction no
// real (unquoted) `;`/`&`/`|`/newline left to exclude, so the gap between a
// tool name and its subcommand is simply `[\s\S]*` (not `.*`, since a
// quoted argument can legitimately contain a real embedded newline that a
// plain `.` wouldn't match without the `s` flag).
export const DANGEROUS_PATTERNS = [
  // sudo must be checked before destructive-rm: "sudo rm -r x" is expected
  // (by this module's own tests, and by Task 18's contract) to report
  // 'sudo', not 'destructive-rm' — order in this array is what decides
  // which id gets reported when a command matches more than one pattern.
  // sudo is also the most fundamental hard rule: escalating to root doesn't
  // just do one dangerous thing, it removes every other permission check
  // that would have stopped a *different* dangerous thing. (This ordering
  // also means `curl ... | sudo sh` reports 'sudo', not 'pipe-to-shell' —
  // consistent with the same principle: the more severe, harder-to-recover
  // classification wins when a command genuinely matches more than one
  // rule.)
  {
    id: 'sudo',
    re: /\bsudo\b/,
    reasonKey: 'safety.sudo',
    hard: true,
  },
  // Originally `\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]` (plan's own regex,
  // already correct for short flags). Extended (round 1) to also catch GNU
  // long-form `--recursive`/`--force`, which are exactly as destructive as
  // `-r`/`-f` but were not matched at all by the short-flag-only version —
  // `rm --recursive --force /` sailed straight through undetected. The
  // repeated prefix group accepts either a short flag (`-[a-zA-Z]*`) or a
  // long flag (`--[a-zA-Z][a-zA-Z-]*`) followed by whitespace, and the
  // terminal alternative adds `--recursive`/`--force` alongside the
  // existing short-flag-ending-in-r-or-f case. The long-flag alternatives
  // use a negative lookahead `(?![a-zA-Z-])` rather than `\b`, because `\b`
  // would also hold at the hyphen in "--force-something-fake" (word 'e' to
  // non-word '-' is a boundary) and wrongly block an unrelated made-up
  // flag; the lookahead instead demands the flag name actually ends here.
  // No `[\s\S]*`-shaped gap here (never needed one — `rm`'s own flags are
  // adjacent to it by construction), so this rule was never vulnerable to
  // either round-3 Critical; quoting bypasses (`"rm" -rf /`) are handled by
  // segmentation dequoting the token, not by anything in this regex.
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
  // undo), hence `hard: true`.
  {
    id: 'find-delete',
    re: /\bfind\b[\s\S]*(-delete\b|-exec\s+rm\b)/,
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
  //    `\bdd\b[\s\S]*\bif=` (which would still miss `dd of=/dev/sda` with
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
  //    /dev/sdb`, `tee /dev/sda`). Added `\b(cp|tee)\b[\s\S]*\/dev\/(sd|
  //    nvme|disk)` — deliberately doesn't distinguish source vs.
  //    destination position (cp's destination is usually, but not always
  //    provably from a regex, the last argument), so `cp /dev/sda
  //    backup.img` — a legitimate disk-image *read* — also blocks. Over-
  //    blocking is the accepted direction here: unattended reads of a raw
  //    device are unusual enough to warrant a human look too.
  {
    id: 'disk-write',
    re: /\bmkfs\b|\bdd\b|>\s*\/dev\/(sd|nvme|disk)|>\s*\/etc\/(passwd|shadow|sudoers)(?![\w.-])|\b(cp|tee)\b[\s\S]*\/dev\/(sd|nvme|disk)/,
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
  // `\bgit\b[\s\S]*\bpush\b` — see the file-level comment for the accepted
  // false-positive trade this shape carries (the word "push" can now
  // appear anywhere in the same segment, including inside an unrelated
  // flag value: `git log --grep=push` still blocks, and that's accepted —
  // but *not* inside a quoted multi-word argument any more: `git commit -m
  // "add push support"` no longer blocks, because segmentation fuses that
  // argument's internal whitespace and "push" stops being a `\b`-bounded
  // word — see the file-level comment's closing paragraph).
  {
    id: 'git-push',
    re: /\bgit\b[\s\S]*\bpush\b/,
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
    re: /\bgit\b[\s\S]*\b(reset\s+--hard\b|clean\s+(?:-[a-zA-Z]*[fd]|--force(?![a-zA-Z-]))|filter-branch\b)/,
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
    re: /\bdocker\b[\s\S]*\b(system\s+prune|volume\s+rm)\b/,
    reasonKey: 'safety.container-prune',
    hard: false,
  },
  // Round-2: `kubectl -n staging delete deployment x` slipped past
  // `\bkubectl\s+delete\b` for the same reason as git-push/git-destructive
  // above — `-n <namespace>` is completely ordinary kubectl usage, not an
  // edge case.
  {
    id: 'k8s-delete',
    re: /\bkubectl\b[\s\S]*\bdelete\b/,
    reasonKey: 'safety.k8s-delete',
    hard: false,
  },
  // Not in round 2's 16 leaks, but the same root cause applies equally:
  // `terraform -chdir=infra apply` and `helm --kube-context prod upgrade`
  // are both standard usage that the original `\bterraform\s+apply\b`-
  // shaped regex would have missed. Fixed proactively rather than waiting
  // for another round to find it by example.
  {
    id: 'iac-apply',
    re: /\b(terraform\b[\s\S]*\b(apply|destroy)|helm\b[\s\S]*\b(upgrade|delete|uninstall))\b/,
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
    re: /\b(npm\b[\s\S]*\bpublish|twine\b[\s\S]*\bupload|cargo\b[\s\S]*\bpublish|gh\b[\s\S]*\brelease\s+create)\b/,
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
  //
  // Round 3: this `re` is kept for structural consistency (every pattern
  // has one — see the "every pattern has a reason key" test) and as a
  // human-readable summary of what this rule targets, but it is **not**
  // what `checkCommand` actually tests against a segment. Unlike every
  // other rule, "does a curl/wget segment feed via a real pipe into a
  // shell segment" is a relationship *between* two segments, not a pattern
  // within one — segmenting on `|` (needed so `git status | grep push`
  // doesn't look like one blob to git-push) throws away the very
  // adjacency this rule needs to see. So detection runs through
  // `hasPipeToShell` instead, which walks segment-to-segment pipe chains
  // directly (see below) rather than trying to express "the next segment
  // in the chain" inside a single regex.
  {
    id: 'pipe-to-shell',
    re: /(curl|wget)[^|]*\|\s*(sudo\s+)?(ba|z|da|k|fi)?sh\b/,
    reasonKey: 'safety.pipe-to-shell',
    hard: false,
  },
  // Deliberately the broadest rule in the list — see reasonKey text for the
  // full rationale (brief section D requires this to be stated explicitly
  // to the user, not just implied by the code). Kept last so a command that
  // also matches a more specific rule (e.g. "terraform apply for prod",
  // which also contains "prod") reports the more actionable, specific id
  // first — pinned by its own ordering test, the same way sudo-before-
  // destructive-rm is, so a future insert can't silently move it.
  {
    id: 'deploy-words',
    re: /\b(deploy|prod|production|release)\b/i,
    reasonKey: 'safety.deploy-words',
    hard: false,
  },
];

// Not part of DANGEROUS_PATTERNS: neither the empty-command nor the
// too-long-to-analyze case is a dangerous *pattern* match (there is either
// nothing to run, or nothing this module will safely attempt to check), so
// neither belongs in the array the "pattern ids are unique / every pattern
// has a re" invariant is checked against. Both still need a reason text a
// caller can look up by patternId, which reasonKeyFor below provides
// uniformly across all three cases.
const EMPTY_PATTERN_ID = 'empty';
const EMPTY_REASON_KEY = 'safety.empty';
const TOO_LONG_PATTERN_ID = 'too-long';
const TOO_LONG_REASON_KEY = 'safety.too-long';

/**
 * Quote-aware linear scan, used in place of both round 2's character-class
 * gap (`[^;&|]*`) and its lossy `normalizeForMatching` pre-pass — see the
 * file-level comment for why both were insufficient. Single pass, O(n),
 * tracks quote state (none / single / double) and does three things at
 * once:
 *
 *   1. Splits into segments on `;`, `&`, `|`, and newline, but *only* when
 *      one occurs outside any quote — a quoted separator
 *      (`git -C ";" push`) is ordinary argument content, not a boundary.
 *      Each segment carries the real (unquoted) delimiter that ended it
 *      (`;`, `&`, `|`, `\n`, or `null` for the last segment), since
 *      `hasPipeToShell` below needs to know specifically which segments
 *      are pipe-chained to which.
 *   2. Drops quote delimiter characters themselves (they're syntax, not
 *      argument content) and resolves a backslash the same way round 2's
 *      `normalizeForMatching` did: before a non-whitespace character, drop
 *      the backslash and keep the character (`r\m` -> `rm`, matching what
 *      the shell does); before whitespace, keep the backslash as a
 *      non-fusing barrier (`rm\ -rf` must not look like `rm -rf` with real
 *      separating whitespace between `rm` and `-rf` — that specific
 *      command is genuinely harmless: bash reports "command not found"
 *      for a binary literally named "rm -rf").
 *   3. Replaces whitespace *found while inside a quote* with `_` instead
 *      of a real space. This is what lets a single quoted word used *as* a
 *      token (`"rm" -rf /`) still dequote to a real, matchable `rm`, while
 *      a multi-word quoted *argument* that happens to contain a
 *      dangerous-looking substring (`echo "don't rm -rf things"`, `grep
 *      'git push' log.txt`) instead becomes one fused, underscore-joined
 *      blob (`don't_rm_-rf_things`) in which `rm`/`push` are no longer
 *      `\b`-bounded words (their neighbor is `_`, a `\w` character) and are
 *      no longer followed by real whitespace either. Backslash is *not*
 *      treated specially inside single quotes (real shells give it no
 *      escaping power there); inside double quotes it's resolved the same
 *      way as unquoted, except a backslash-before-whitespace does not need
 *      the same non-fusing-barrier treatment, because that whitespace was
 *      already going to be fused to `_` regardless.
 */
function splitIntoCanonicalSegments(cmd) {
  const segments = [];
  let out = '';
  let quote = null; // null | "'" | '"'
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote === "'") {
      if (ch === "'") { quote = null; continue; }
      out += /\s/.test(ch) ? '_' : ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < cmd.length) {
        const next = cmd[++i];
        out += /\s/.test(next) ? '_' : next;
        continue;
      }
      if (ch === '"') { quote = null; continue; }
      out += /\s/.test(ch) ? '_' : ch;
      continue;
    }
    // Unquoted.
    if (ch === '\\' && i + 1 < cmd.length) {
      const next = cmd[i + 1];
      if (/\s/.test(next)) {
        // Preserve backslash-escaped whitespace as a non-separator,
        // non-fusing barrier; do not consume `next` here, let the normal
        // unquoted-whitespace path below emit it on the following
        // iteration.
        out += ch;
        continue;
      }
      out += next;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') {
      segments.push({ text: out, delimiter: ch });
      out = '';
      continue;
    }
    out += ch;
  }
  segments.push({ text: out, delimiter: null });
  return segments;
}

// A curl/wget-to-shell relationship is a property of *adjacent* pipe
// segments, not of any single segment — see pipe-to-shell's comment above.
// Walks every candidate starting segment (one that contains curl/wget and
// is itself pipe-delimited), then follows the pipe chain forward through
// any number of intermediate hops (`curl ... | tee out.sh | sh` still
// ultimately feeds curl's output to a shell, even though the shell isn't
// the *immediate* next segment) until it either finds a shell-starting
// segment (hit) or the chain breaks on a non-`|` delimiter or the end of
// the command (no hit through this starting point).
function hasPipeToShell(segments) {
  const shellStart = /^\s*(sudo\s+)?(ba|z|da|k|fi)?sh\b/;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].delimiter !== '|') continue;
    if (!/\b(curl|wget)\b/.test(segments[i].text)) continue;
    let j = i + 1;
    while (j < segments.length) {
      if (shellStart.test(segments[j].text)) return true;
      if (segments[j].delimiter !== '|') break;
      j++;
    }
  }
  return false;
}

/**
 * Resolve any patternId `checkCommand` can ever return — including the
 * `'empty'` and `'too-long'` sentinels, neither of which has an entry in
 * `DANGEROUS_PATTERNS` — to its i18n reason key. Returns null for an id
 * that isn't recognized, rather than throwing, so a caller can defensively
 * check before calling `t()`.
 */
export function reasonKeyFor(patternId) {
  if (patternId === EMPTY_PATTERN_ID) return EMPTY_REASON_KEY;
  if (patternId === TOO_LONG_PATTERN_ID) return TOO_LONG_REASON_KEY;
  return DANGEROUS_PATTERNS.find((p) => p.id === patternId)?.reasonKey ?? null;
}

/**
 * Whether `--allow` is even eligible to override this rule. See
 * checkCommand. `'empty'` and `'too-long'` both report `true` here even
 * though neither is a `DANGEROUS_PATTERNS` entry: `checkCommand` never
 * even evaluates `allowPatterns` for either case (see below), so both are
 * non-overridable in fact, and `isHardRule` should say so rather than
 * defaulting an unrecognized id to `false`.
 */
export function isHardRule(patternId) {
  if (patternId === EMPTY_PATTERN_ID || patternId === TOO_LONG_PATTERN_ID) return true;
  return DANGEROUS_PATTERNS.find((p) => p.id === patternId)?.hard === true;
}

/**
 * Decide whether `cmd` may be executed.
 *
 * Return shape (deliberately richer than the plan's `{blocked, patternId}`
 * — see task-16-report.md section C for the full reasoning):
 *   - `blocked`: true iff the command must not run.
 *   - `patternId`: the id of the rule currently blocking it, or the
 *     `'empty'`/`'too-long'` sentinels for blank or oversized input; null
 *     whenever blocked is false.
 *   - `overriddenBy`: the id of the rule that *would* have blocked this
 *     command had an `--allow` pattern not matched it; null otherwise. This
 *     is what lets Task 18's verify report "this would have been blocked by
 *     X, but you explicitly allowed it" instead of the override silently
 *     erasing which rule was in play.
 *
 * Matching runs against every segment `splitIntoCanonicalSegments` produces
 * (see its own comment for the full reasoning), not the raw command
 * string; the reported `patternId` is the same rule id regardless of which
 * segment tripped it, since that isn't something a caller needs to act on
 * differently.
 *
 * Commands over `MAX_COMMAND_LENGTH` are refused immediately, before any
 * segmentation or pattern matching runs, as `'too-long'` — and, notably,
 * before `allowPatterns` is evaluated too: the whole point of the length
 * cap is that *no* regex, whether one of this module's own or a caller-
 * supplied `--allow` pattern of unknown shape, should ever run against
 * unbounded adversarial input, so `'too-long'` is not overridable (see
 * `isHardRule`).
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
  if (cmd.length > MAX_COMMAND_LENGTH) {
    return { blocked: true, patternId: TOO_LONG_PATTERN_ID, overriddenBy: null };
  }

  const segments = splitIntoCanonicalSegments(cmd);
  let hit = null;
  for (const p of DANGEROUS_PATTERNS) {
    if (p.id === 'pipe-to-shell') {
      if (hasPipeToShell(segments)) { hit = p; break; }
      continue;
    }
    if (segments.some((seg) => p.re.test(seg.text))) { hit = p; break; }
  }
  if (!hit) return { blocked: false, patternId: null, overriddenBy: null };

  const allowed = allowPatterns.some((re) => re.test(cmd));
  if (allowed && !hit.hard) {
    return { blocked: false, patternId: null, overriddenBy: hit.id };
  }
  return { blocked: true, patternId: hit.id, overriddenBy: null };
}
