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
 *
 * Fourth adversarial review round (fix base 939d689) found one more
 * Critical and one Important, both in `splitIntoCanonicalSegments` itself:
 *
 *   C. Bash joins an unquoted (or double-quoted) `\<newline>` pair into a
 *      single logical line *before* parsing anything else — the backslash
 *      and the newline are both removed entirely, not preserved as a
 *      literal separator. `splitIntoCanonicalSegments` didn't know this: it
 *      treated a bare newline as always ending a segment (matching its
 *      "unquoted separator" handling for `;`/`&`/`|`), so
 *      `git \<newline> push origin main` — one real command, per bash —
 *      landed in two different segments and neither one contained both
 *      "git" and "push". This is systemic: it hits any rule that needs to
 *      see two things (a tool name and a subcommand/flag) in the same
 *      segment, which is most of them, including two hard rules
 *      (`destructive-rm`, `find-delete`). Fixed by detecting `\<LF>` and
 *      `\<CRLF>` line continuations and consuming both characters (three
 *      for CRLF) with nothing emitted, *before* any of the quote/delimiter
 *      logic runs — checked first in the loop, ahead of both the unquoted
 *      and double-quoted backslash handling, since a plain "backslash
 *      before whitespace" check would otherwise catch the newline first
 *      (newline is whitespace) and take the wrong branch. This one
 *      *doesn't* apply inside single quotes: real shells give backslash no
 *      escaping power there at all, so `'a \<newline>b'` keeps both
 *      characters fully literal, and the scan already skips the
 *      continuation check whenever `quote === "'"`.
 *   D. An unterminated quote (`git -C "unclosed push origin main`) made the
 *      scanner fail *open*: `quote` was left non-null when the loop ended,
 *      but the code still emitted whatever partial segments it had built
 *      and let `checkCommand` match against them, i.e. it happily reasoned
 *      about a parse it already knew was broken. Not exploitable today —
 *      a real shell rejects this input outright with "unexpected EOF while
 *      looking for matching quote" — but a safety boundary shouldn't rely
 *      on a downstream parser to catch what it already knows it can't
 *      trust. Fixed the same way `too-long` handles unanalyzable input:
 *      `splitIntoCanonicalSegments` now returns `null` when the scan ends
 *      with an open quote, and `checkCommand` treats that as an immediate,
 *      non-overridable block (`'unterminated-quote'`) rather than matching
 *      against segments derived from a parse it knows is unreliable.
 *
 * Fifth adversarial review round (fix base a7f5644), found while probing
 * the round-4 fix, turned out to be unrelated to it: destructive-rm and
 * git-destructive's `reset`/`clean` sub-cases both required the dangerous
 * flag to sit *immediately* after the tool/subcommand word (with, at most,
 * other flags in between for `rm`) — a single non-flag operand first
 * defeated both. `rm a -rf /`, `rm foo --force`, `git reset HEAD~1 --hard`,
 * `git clean untracked.txt -f` all walked straight through. This is real,
 * not theoretical: GNU coreutils' getopt permutes options after operands
 * by default, and the same is true of git's own argument parsing —
 * confirmed against both a real GNU rm and a real git repo, not reasoned
 * about, including a same-command comparison across platforms (BSD `rm
 * <dir> -rf` errors and leaves the directory alone; GNU coreutils 9.5 `rm
 * <dir> -rf` deletes the tree — Linux, the dangerous platform, is where CI
 * and servers actually run). Every other rule in this file already uses an
 * unbounded `[\s\S]*` gap between tool and subcommand/flag, which
 * inherently tolerates any argument order; these two were the only
 * holdouts still using a *restricted* gap (destructive-rm's flag-only
 * repeat group; git-destructive's zero-tolerance `reset\s+--hard`/
 * `clean\s+flags`), which is exactly what broke under permutation. Fixed
 * by moving both to token-based scans (`hasDangerousRm`,
 * `hasGitDestructive`, below) that check every token *after* the relevant
 * word, not just the adjacent ones, with an explicit, documented decision
 * about GNU/POSIX's `--` end-of-options marker (see destructive-rm's own
 * comment). Applying the same lens to every other rule (disk-write's
 * cp/tee, container-prune, k8s-delete, iac-apply, publish, dd, find-delete)
 * found no further instances — each already tolerates argument permutation
 * by construction, verified empirically per rule, not assumed; see
 * task-16-report.md's round-5 section for the full coverage list.
 *
 * Sixth adversarial review round (fix base b32a939) found two more,
 * neither a variation on round 5's:
 *
 *   A. Round 5's token scanners (`hasDangerousRm`, `hasGitDestructive`)
 *      compare a token to a bare tool name with `===` — `'/bin/rm' ===
 *      'rm'` is false, so a path-prefixed invocation, which is completely
 *      ordinary (`/bin/rm -rf /`, `./rm -rf /`, `/usr/bin/git reset
 *      --hard`), walked straight through both. Every *regex*-based rule
 *      was already immune to this, for free: `\b` treats `/` as a
 *      non-word character, so `\bdd\b`, `\bfind\b`, `\b(cp|tee)\b` etc.
 *      all matched a path-prefixed token correctly without any special
 *      handling. This gap was specific to the two rules round 5 moved off
 *      regex matching entirely. Fixed with `basename` (below): compare a
 *      token's *last path component* to the tool name, still with exact
 *      equality (not a substring match), so a differently-named tool that
 *      merely contains the tool name — `my-rm-wrapper`, `./scripts/
 *      rm-old-logs.sh` — does not start matching.
 *   B. `sh -c "..."`, `bash -lc "..."`, `eval "..."` hand a whole new
 *      command line to a shell interpreter as a single argument, and
 *      nothing inside that argument was ever visible to any rule — it's
 *      just one opaque, whitespace-fused token to every scanner in this
 *      file. `sh -c "rm -rf /"`, `bash -c "git push"`, `eval "rm -rf /"`
 *      all walked straight through, undetected by every rule simultaneously
 *      (not a single rule's bug — a category no rule was designed to see
 *      into at all). Deliberately fixed by blocking the *pattern* itself
 *      (`hasShellIndirection`, below) rather than recursively extracting
 *      and re-checking the payload — see that function's comment for the
 *      full reasoning; in short, recursive checking needs a second,
 *      non-whitespace-fusing tokenizer (reusing the existing fused
 *      `segment.text` would corrupt the payload's own internal structure)
 *      plus a carefully bounded recursion depth, real complexity in
 *      exactly the place five rounds of review have shown new complexity
 *      tends to hide the next bug. This is a *soft* rule — `--allow`
 *      remains the escape hatch for a payload a human has actually read.
 *
 * Seventh and final adversarial review round (fix base cdfe99c) generalized
 * round 6's own shell-indirection principle one level earlier: `$(which
 * rm) -rf /` and `$SHELL -c "rm -rf /"` supply the *binary itself* through
 * a shell expansion (command substitution or a variable reference), so
 * this module cannot know what will run — the same "unanalyzable, so
 * refuse rather than guess" reasoning as shell-indirection, just applied
 * to the program name instead of a `-c`/`eval` payload. `hasUnresolvedBinary`
 * (below) blocks a `$`- or backtick-led token in binary position — scoped
 * deliberately to that position only, so `npm test --grep "$PATTERN"` and
 * `make BUILD_DIR=$HOME/out` (expansions in *argument* position, completely
 * ordinary) are unaffected. This is the last round: see task-16-report.md's
 * Limitations section for what this module still cannot see (arbitrary
 * evasion through shell expansion beyond the binary position, ANSI-C
 * quoting) and why those are a deliberately accepted boundary rather than
 * an oversight.
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
  // already correct for short flags), extended (round 1) for GNU long-form
  // `--recursive`/`--force`. Round 5 found this whole *shape* was broken:
  // the repeated prefix group only ever consumed *flag-shaped* tokens
  // (`-[a-zA-Z]*` or `--word`), so a single non-flag operand before the
  // dangerous flag defeated the match entirely — `rm a -rf /`, `rm dir1
  // dir2 -rf`, `rm foo --force` all walked straight through, because
  // nothing in the pattern could "skip over" `a`/`dir1 dir2`/`foo` to
  // reach the flag. GNU coreutils' getopt permutes options after operands
  // by default — confirmed empirically on both platforms rather than
  // assumed: BSD `rm <dir> -rf` errors ("No such file or directory") and
  // leaves the directory alone, but GNU coreutils 9.5 `rm <dir> -rf`
  // deletes the tree. Linux is where CI and servers run, so this was live
  // on the primary deployment target; testing only on macOS would have
  // concluded "not exploitable" and been wrong.
  //
  // Detection moved to `hasDangerousRm` (below), a token-based scan: once
  // an `rm` token is found in a segment, every token *after* it — not just
  // the immediately-following ones — is checked for a dangerous flag,
  // stopping at a literal `--` end-of-options marker. `rm -- -rf` is
  // deliberately *not* blocked: per GNU/POSIX convention, `--` means
  // everything after it is a filename, not an option, so `rm -- -rf`
  // deletes (or errors on) a file literally named "-rf" — it does not
  // recursively force-delete anything, and blocking it would be a pure
  // false positive with no safety benefit. The dangerous-short-flag check
  // (`-[a-zA-Z]*[rfRF][a-zA-Z]*`) also adds uppercase `R`/`F`: GNU rm
  // documents `-r`/`-R` as equivalent recursive aliases (there's no
  // documented `-F`, but including it costs nothing and matches this
  // module's standing bias toward over-blocking). This `re` field is kept
  // for structural consistency with every other entry (see the "every
  // pattern has a reason key" test) and as a human-readable summary of the
  // shape this rule targets, but — like `pipe-to-shell` — it is not what
  // `checkCommand` actually evaluates.
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
  // Loosened `git` -> subcommand the same way, on the stated (round-2)
  // assumption that `reset -> --hard` and `clean -> its flags` didn't need
  // the same loosening, since they're "subcommand-internal option pairs
  // ... always written adjacently in practice."
  //
  // Round 5 tested that assumption instead of continuing to trust it — the
  // same lens the coordinator applied to `rm` — and found it false, with a
  // real git repo, not just reasoning: `git reset HEAD~1 --hard` (commit-
  // ish before the flag) and `git reset --quiet --hard HEAD~1` (another
  // flag before `--hard`) both perform a real hard reset; `git clean
  // untracked.txt -f` and `git clean dirA -fd` (a pathspec before the
  // flags) both really delete. None of these matched `reset\s+--hard\b` or
  // `clean\s+(?:...)`, which required the flag *immediately* after the
  // subcommand word with nothing but literal whitespace in between — the
  // exact same structural bug as destructive-rm's, just one level up.
  //
  // Detection for the `reset`/`clean` sub-cases moved to `hasGitDestructive`
  // (below): once `reset` or `clean` is found as a token in a segment that
  // also contains `git`, every token after it is checked for the relevant
  // dangerous flag (stopping at a literal `--`, same reasoning as
  // destructive-rm — `git reset -- --hard` would pass `--hard` as a
  // revision/pathspec, not a flag). `filter-branch` needed no such change:
  // it was never a "flag after subcommand" check, just "does the bare
  // subcommand name appear at all" — already tolerant of any argument
  // order via the free-form gap, same as k8s-delete/container-prune below.
  // This `re` field is documentation-only, like destructive-rm's above.
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
  // Round 6, Critical B — see `hasShellIndirection`'s comment (below the
  // array) for the full design writeup and why this blocks the *pattern*
  // outright rather than recursively inspecting the payload. Soft, not
  // hard: unlike sudo/destructive-rm/find-delete/disk-write, this rule
  // isn't asserting the payload *is* dangerous — only that this module
  // chose not to look, so a human who has actually read the payload can
  // vouch for it via `--allow` the same way they would for any other
  // over-broad rule. This `re` field is documentation-only, like
  // destructive-rm's and git-destructive's above — real detection is
  // `hasShellIndirection`, which needs to reason about flag tokens
  // (`-c`, `-lc`) and `eval` specifically, not a substring pattern.
  {
    id: 'shell-indirection',
    re: /\b(sh|bash|zsh|dash|ksh)\b[\s\S]*-[a-zA-Z]*c[a-zA-Z]*\b|\beval\b/,
    reasonKey: 'safety.shell-indirection',
    hard: false,
  },
  // Round 7 (final round) — see `hasUnresolvedBinary`'s comment (below the
  // array) for the full design. Generalizes shell-indirection's own
  // principle one level earlier: not just "the payload is opaque," but
  // "the binary name itself is." Soft, for the same reason
  // shell-indirection is: this module is declining to guess, not
  // asserting the resolved binary is definitely dangerous. This `re`
  // field is documentation-only, like the other token-scanner rules above.
  {
    id: 'unresolved-binary',
    re: /^\s*(?:(?:sudo|nohup|time|command|xargs|env)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*[$`]/,
    reasonKey: 'safety.unresolved-binary',
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

// Not part of DANGEROUS_PATTERNS: an empty command, a too-long command, and
// a command with an unterminated quote are none of them a dangerous
// *pattern* match (there is either nothing to run, or nothing this module
// will safely attempt to check), so none of the three belongs in the array
// the "pattern ids are unique / every pattern has a re" invariant is
// checked against. Each still needs a reason text a caller can look up by
// patternId, which reasonKeyFor below provides uniformly across all three.
const EMPTY_PATTERN_ID = 'empty';
const EMPTY_REASON_KEY = 'safety.empty';
const TOO_LONG_PATTERN_ID = 'too-long';
const TOO_LONG_REASON_KEY = 'safety.too-long';
const UNTERMINATED_QUOTE_PATTERN_ID = 'unterminated-quote';
const UNTERMINATED_QUOTE_REASON_KEY = 'safety.unterminated-quote';

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
 *   4. Removes an unquoted or double-quoted `\<LF>`/`\<CRLF>` line
 *      continuation entirely (see round-4 finding C in the file-level
 *      comment) — checked first, before anything else, so it can't be
 *      shadowed by the more general "backslash before whitespace" handling
 *      in (2) (a bare newline is whitespace too, and that path is for a
 *      genuinely different case). Does not apply inside single quotes,
 *      where backslash has no special meaning and both characters of
 *      `\<newline>` stay fully literal, same as any other character there.
 *
 * Returns `null` — instead of a segments array — if the scan ends with a
 * quote still open (round-4 finding D): rather than match dangerous-command
 * rules against segments derived from a parse it already knows is broken,
 * `checkCommand` treats a `null` return as its own immediate, non-
 * overridable block. Not exploitable today (a real shell rejects
 * unterminated-quote input outright, before it would ever run), but a
 * safety boundary shouldn't depend on a downstream parser to catch what it
 * already knows it can't reliably reason about.
 */
function splitIntoCanonicalSegments(cmd) {
  const segments = [];
  let out = '';
  let quote = null; // null | "'" | '"'
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    if (quote !== "'") {
      if (ch === '\\' && cmd[i + 1] === '\n') { i += 1; continue; }
      if (ch === '\\' && cmd[i + 1] === '\r' && cmd[i + 2] === '\n') { i += 2; continue; }
    }

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
  if (quote !== null) return null; // unterminated quote — see the doc comment above
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

// A short `rm` flag token is dangerous if it contains `r`, `f`, `R`, or `F`
// anywhere among its letters — GNU rm documents `-r`/`-R` as equivalent
// recursive aliases (checked; `-F` has no documented meaning, included
// only for symmetry, consistent with this module's bias toward
// over-blocking rather than precision). Matches a combined flag like
// `-vrf` or `-Rv` regardless of where the dangerous letter falls, not just
// at the end.
const DANGEROUS_SHORT_RM_FLAG = /^-[a-zA-Z]*[rfRF][a-zA-Z]*$/;

// Round 6: the token scanners below compare a token to a literal tool name
// (`'rm'`, `'git'`) with `===`, which broke on `/bin/rm`, `./rm`,
// `../bin/rm`, `/usr/bin/git reset --hard`, etc. — a path-prefixed
// invocation, which is completely ordinary, never equals the bare name.
// (Every *regex*-based rule in this file was already immune to this: `\b`
// treats `/` as a non-word character, so `\bdd\b`, `\bfind\b`, `\b(cp|
// tee)\b` etc. all matched a path prefix correctly without any special
// handling — this is specific to the token-equality rules introduced in
// round 5.) `basename` extracts the last path component so the comparison
// is against *that*, not the whole token. This is an exact-equality
// comparison on the extracted basename, not a substring/prefix match —
// deliberately, so a differently-named tool that merely *contains* the
// tool name doesn't start matching: `my-rm-wrapper` has basename
// `my-rm-wrapper` (not `rm`), `./scripts/rm-old-logs.sh` has basename
// `rm-old-logs.sh` (not `rm`), both correctly excluded. No extension
// stripping (e.g. `rm.exe`) — this module models POSIX/bash shell
// semantics, not Windows, consistent with its scope everywhere else.
function basename(token) {
  const idx = token.lastIndexOf('/');
  return idx === -1 ? token : token.slice(idx + 1);
}

// Token-based, not regex-over-the-whole-segment, specifically so a
// non-flag operand before the dangerous flag can't defeat it (round 5 —
// see destructive-rm's comment above for the full story: GNU getopt
// permutes options after operands, so `rm a -rf /` is exactly as
// dangerous as `rm -rf a /`, and only testing on a platform whose `rm`
// doesn't permute would miss this). Once an `rm` token is found (by
// basename — see round 6 above), every *following* token in the same
// segment is checked, not just the immediately-adjacent ones — until a
// literal `--` end-of-options marker, after which nothing is treated as a
// flag (see destructive-rm's comment for why `rm -- -rf` is deliberately
// not blocked).
function hasDangerousRm(segments) {
  for (const seg of segments) {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      if (basename(tokens[i]) !== 'rm') continue;
      for (let j = i + 1; j < tokens.length; j++) {
        const tok = tokens[j];
        if (tok === '--') break;
        if (tok === '--recursive' || tok === '--force') return true;
        if (DANGEROUS_SHORT_RM_FLAG.test(tok)) return true;
      }
    }
  }
  return false;
}

// Scans `tokens` strictly after `fromIdx` for one that satisfies
// `predicate`, stopping at a literal `--` end-of-options marker (see
// hasDangerousRm's comment — the same GNU/POSIX convention applies to
// git's own subcommands: content after `--` is a revision/pathspec, not a
// flag). Shared by both of hasGitDestructive's flag-position-dependent
// checks below.
function hasFlagAfter(tokens, fromIdx, predicate) {
  for (let i = fromIdx + 1; i < tokens.length; i++) {
    if (tokens[i] === '--') break;
    if (predicate(tokens[i])) return true;
  }
  return false;
}

// Token-based for the same reason as hasDangerousRm — round 5 confirmed
// (against a real git repo, not just reasoning) that `git reset HEAD~1
// --hard` (a revision before the flag) and `git clean untracked.txt -f` (a
// pathspec before the flag) both perform the real destructive action, and
// neither matched the old `reset\s+--hard\b`/`clean\s+(?:...)` regex,
// which required the flag *immediately* after the subcommand word. Once
// `git` (by basename — round 6, see above: `/usr/bin/git reset --hard`
// wasn't found by `tokens.includes('git')` either, same root cause as
// `rm`) and (`reset` or `clean`) are both found as tokens in a segment,
// every token after the subcommand word is checked for the relevant
// dangerous flag, not just the one immediately following it.
// `filter-branch` needs no such handling: it was never a flag-position
// check, just "does the bare subcommand name appear at all" (see its
// entry's comment above) — `reset`/`clean` themselves also don't need
// basename treatment, since they're subcommand *words*, never invoked via
// a path the way the `git` binary itself can be.
function hasGitDestructive(segments) {
  for (const seg of segments) {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => basename(t) === 'git')) continue;
    if (tokens.includes('filter-branch')) return true;
    const resetIdx = tokens.indexOf('reset');
    if (resetIdx !== -1 && hasFlagAfter(tokens, resetIdx, (t) => t === '--hard')) return true;
    const cleanIdx = tokens.indexOf('clean');
    if (
      cleanIdx !== -1
      && hasFlagAfter(tokens, cleanIdx, (t) => t === '--force' || /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(t))
    ) return true;
  }
  return false;
}

// Round 6, Critical B: `sh -c "rm -rf /"`, `bash -lc "..."`, `eval "..."`
// hand a whole new command line to a shell interpreter as a single
// argument — nothing inside that argument is ever visible to any rule
// above, since it's just one opaque (whitespace-fused, per
// splitIntoCanonicalSegments) token to this scanner.
//
// Two designs were considered (see task-16-report.md's round-6 section
// for the full writeup): (1) recursively extract the payload and check it
// as a command in its own right, or (2) treat the *structural pattern* of
// "-c"/`eval` itself as unreviewable and block it outright, regardless of
// payload content. Went with (2). Recursive checking would need a second,
// non-fusing tokenizer (the existing fused `segment.text` can't be reused
// — round 3's whitespace-fusion, which a recursive check would need to
// *undo* for the payload specifically, is exactly what protects against
// the Important-class false positive elsewhere), correct handling of
// `eval`'s multi-argument-joining semantics, a decision about `-c` vs. a
// positional script-file argument, and a carefully bounded recursion
// depth/budget to avoid `sh -c "sh -c \"sh -c ...\""` becoming a new DoS
// vector — meaningful complexity in exactly the place five rounds of
// review have already shown new complexity tends to hide the next bug.
// Blocking outright is a strictly smaller, more auditable change, keeps
// `--allow` as the escape hatch for a legitimately-reviewed payload (this
// is a *soft* rule — see its DANGEROUS_PATTERNS entry), and the
// coordinator offered it as an equally defensible option.
//
// Detection: a recognized shell name (`sh`/`bash`/`zsh`/`dash`/`ksh`,
// matching pipe-to-shell's existing shell-name set) by basename, followed
// by a short-flag token containing `c` (bare `-c`, or combined like
// `-lc`/`-cl`) before any non-flag token or `--`; or a bare `eval` token
// by basename, unconditionally (eval's very first argument is always
// interpreted as a command). Scanning a shell invocation's arguments stops
// at the first non-flag token: `sh script.sh -c fake` (running a *file*,
// with `-c` appearing later as one of the *script's own* arguments, not
// sh's) must not match — once sh sees a non-option argument, everything
// after it belongs to the script being run, not to sh itself.
function hasShellIndirection(segments) {
  const shellNames = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
  for (const seg of segments) {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const base = basename(tokens[i]);
      if (base === 'eval') return true;
      if (!shellNames.has(base)) continue;
      for (let j = i + 1; j < tokens.length; j++) {
        const tok = tokens[j];
        if (tok === '--') break;
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(tok)) return true;
        if (!tok.startsWith('-')) break;
      }
    }
  }
  return false;
}

// Round 7 (final round): `$(which rm) -rf /` and `$SHELL -c "rm -rf /"`
// both supply the *binary itself* through a shell expansion — a
// generalization of shell-indirection's own principle ("unanalyzable, so
// refuse rather than guess"), applied one level earlier: not just "the
// payload of -c/eval is opaque," but "the very name of the program about
// to run is." A token starting with `$` (covers `$(...)` command
// substitution, `$VAR`, and `${VAR}` — all three share that leading
// character) or a backtick (the other command-substitution syntax) in
// binary position means this module cannot know what will execute.
//
// Deliberately scoped to *binary position only* — `npm test --grep
// "$PATTERN"` and `make BUILD_DIR=$HOME/out` are completely ordinary and
// must not be flagged, since an expansion in argument position doesn't
// change *what program* runs. "Binary position" here means: the first
// token of a segment, after skipping a leading chain of recognized prefix
// commands (`sudo`, `nohup`, `time`, `command`, `xargs`, `env` — the same
// ones round 6 confirmed must stay unblocked on their own) and
// `VAR=value`-shaped assignment tokens in front of it, e.g. `env FOO=1
// $(which rm) -rf /`.
//
// Deliberately does *not* attempt to also skip a prefix command's own
// flags (`sudo -u root $(which rm) -rf /` is not caught by this — the
// scan lands on `-u`, which doesn't look like an expansion, and stops
// there) — modeling each prefix command's own flag syntax is exactly the
// kind of speculative complexity six rounds of review have shown tends to
// hide the next bug, and neither of this round's two actual findings
// needed it. Disclosed explicitly in task-16-report.md's Limitations
// section rather than silently left as an assumed-complete fix.
const INDIRECTION_PREFIX_COMMANDS = new Set(['sudo', 'nohup', 'time', 'command', 'xargs', 'env']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function hasUnresolvedBinary(segments) {
  for (const seg of segments) {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    let i = 0;
    while (
      i < tokens.length
      && (INDIRECTION_PREFIX_COMMANDS.has(basename(tokens[i])) || ENV_ASSIGNMENT.test(tokens[i]))
    ) {
      i++;
    }
    if (i >= tokens.length) continue;
    const candidate = tokens[i];
    if (candidate.startsWith('$') || candidate.startsWith('`')) return true;
  }
  return false;
}

// Rule ids whose real detection logic is one of the functions above rather
// than `p.re.test(segment.text)` — see checkCommand's matching loop.
const DEDICATED_MATCHERS = {
  'destructive-rm': hasDangerousRm,
  'git-destructive': hasGitDestructive,
  'pipe-to-shell': hasPipeToShell,
  'unresolved-binary': hasUnresolvedBinary,
  'shell-indirection': hasShellIndirection,
};

/**
 * Resolve any patternId `checkCommand` can ever return — including the
 * `'empty'`, `'too-long'`, and `'unterminated-quote'` sentinels, none of
 * which has an entry in `DANGEROUS_PATTERNS` — to its i18n reason key.
 * Returns null for an id that isn't recognized, rather than throwing, so a
 * caller can defensively check before calling `t()`.
 */
export function reasonKeyFor(patternId) {
  if (patternId === EMPTY_PATTERN_ID) return EMPTY_REASON_KEY;
  if (patternId === TOO_LONG_PATTERN_ID) return TOO_LONG_REASON_KEY;
  if (patternId === UNTERMINATED_QUOTE_PATTERN_ID) return UNTERMINATED_QUOTE_REASON_KEY;
  return DANGEROUS_PATTERNS.find((p) => p.id === patternId)?.reasonKey ?? null;
}

/**
 * Whether `--allow` is even eligible to override this rule. See
 * checkCommand. `'empty'`, `'too-long'`, and `'unterminated-quote'` all
 * report `true` here even though none is a `DANGEROUS_PATTERNS` entry:
 * `checkCommand` never even evaluates `allowPatterns` for any of the three
 * (see below), so all are non-overridable in fact, and `isHardRule` should
 * say so rather than defaulting an unrecognized id to `false`.
 */
export function isHardRule(patternId) {
  if (
    patternId === EMPTY_PATTERN_ID
    || patternId === TOO_LONG_PATTERN_ID
    || patternId === UNTERMINATED_QUOTE_PATTERN_ID
  ) return true;
  return DANGEROUS_PATTERNS.find((p) => p.id === patternId)?.hard === true;
}

/**
 * Decide whether `cmd` may be executed.
 *
 * Return shape (deliberately richer than the plan's `{blocked, patternId}`
 * — see task-16-report.md section C for the full reasoning):
 *   - `blocked`: true iff the command must not run.
 *   - `patternId`: the id of the rule currently blocking it, or the
 *     `'empty'` / `'too-long'` / `'unterminated-quote'` sentinels for
 *     blank, oversized, or unparseable input; null whenever blocked is
 *     false.
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
 * `isHardRule`). A command whose quoting `splitIntoCanonicalSegments`
 * cannot reliably resolve (an unterminated quote) is refused the same way,
 * as `'unterminated-quote'`, for the same reason: don't reason about — or
 * let `--allow` reason about — a parse already known to be broken.
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
  if (segments === null) {
    return { blocked: true, patternId: UNTERMINATED_QUOTE_PATTERN_ID, overriddenBy: null };
  }

  let hit = null;
  for (const p of DANGEROUS_PATTERNS) {
    // Three rules need cross-token or cross-segment reasoning a single
    // regex-over-one-segment can't express (see each function's own
    // comment for why); every other rule is still a plain per-segment
    // regex test. Each of the three still carries a documentation-only
    // `re` field for structural consistency (see e.g. destructive-rm's
    // comment above).
    const matcher = DEDICATED_MATCHERS[p.id];
    const matched = matcher ? matcher(segments) : segments.some((seg) => p.re.test(seg.text));
    if (matched) { hit = p; break; }
  }
  if (!hit) return { blocked: false, patternId: null, overriddenBy: null };

  const allowed = allowPatterns.some((re) => re.test(cmd));
  if (allowed && !hit.hard) {
    return { blocked: false, patternId: null, overriddenBy: hit.id };
  }
  return { blocked: true, patternId: hit.id, overriddenBy: null };
}
