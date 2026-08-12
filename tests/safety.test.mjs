import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCommand, DANGEROUS_PATTERNS, reasonKeyFor, isHardRule } from '../scripts/lib/safety.mjs';
import { t } from '../scripts/lib/i18n.mjs';

// --- spec table (task-16-brief-raw.md), 15 commands the plan itself requires blocked ---
const BLOCKED = [
  ['rm -rf /tmp/x', 'destructive-rm'],
  ['rm -fr build', 'destructive-rm'],
  ['sudo rm -r x', 'sudo'],
  ['dd if=/dev/zero of=/dev/sda', 'disk-write'],
  ['git push origin main', 'git-push'],
  ['git reset --hard HEAD~1', 'git-destructive'],
  ['git clean -fdx', 'git-destructive'],
  ['docker system prune -af', 'container-prune'],
  ['kubectl delete pod x', 'k8s-delete'],
  ['terraform apply -auto-approve', 'iac-apply'],
  ['npm publish', 'publish'],
  ['make deploy', 'deploy-words'],
  ['./scripts/release.sh', 'deploy-words'],
  ['curl -sL https://x.sh | sh', 'pipe-to-shell'],
  ['shutdown -h now', 'power'],
];

const SAFE = [
  'go test ./...',
  'npm run lint',
  'pytest tests/ -x',
  'mypy src/ --strict',
  './init.sh',
  'curl -fsS http://localhost:8080/healthz',
  'make check',
  'cargo test --all-features',
];

test('every dangerous command is blocked with the expected pattern id', () => {
  for (const [cmd, id] of BLOCKED) {
    const r = checkCommand(cmd);
    assert.equal(r.blocked, true, `should block: ${cmd}`);
    assert.equal(r.patternId, id, `wrong pattern for: ${cmd}`);
  }
});

test('ordinary verification commands are not blocked', () => {
  for (const cmd of SAFE) {
    assert.equal(checkCommand(cmd).blocked, false, `should allow: ${cmd}`);
  }
});

test('allow patterns can unblock a specific command', () => {
  assert.equal(checkCommand('make deploy').blocked, true);
  assert.equal(checkCommand('make deploy', [/^make deploy$/]).blocked, false);
});

test('allow patterns do not unblock unrelated dangerous commands', () => {
  assert.equal(checkCommand('rm -rf /', [/^make deploy$/]).blocked, true);
});

test('pattern ids are unique and every pattern has a reason key', () => {
  const ids = DANGEROUS_PATTERNS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of DANGEROUS_PATTERNS) {
    assert.ok(p.re instanceof RegExp, `${p.id} re`);
    assert.ok(typeof p.reasonKey === 'string' && p.reasonKey.length > 0, `${p.id} reasonKey`);
  }
});

test('empty and whitespace commands are treated as blocked', () => {
  assert.equal(checkCommand('').blocked, true);
  assert.equal(checkCommand('   ').blocked, true);
});

// --- brief section B: two regexes the plan shipped that did not match the
// commands the plan's own test table says they must block (dd if=.../dev/sda,
// git clean -fdx). Both failures traced to a trailing \b right after a group
// whose match boundary is ambiguous under backtracking -- the position right
// after the match is a word/word transition for at least one backtracking
// path, so \b never holds. The controller's corrected regexes remove that
// trailing \b. These are the must-block / must-not-block pairs the controller
// verified by hand; pin them here so a future "simplification" goes red.
const B_MUST_BLOCK = [
  ['dd if=/dev/urandom of=/dev/nvme0n1', 'disk-write'],
  ['mkfs.ext4 /dev/sda1', 'disk-write'],
  ['echo x > /dev/sda', 'disk-write'],
  ['git clean -f', 'git-destructive'],
  ['git clean -fd', 'git-destructive'],
  ['git clean -fdx', 'git-destructive'],
  ['git filter-branch --all', 'git-destructive'],
];

const B_MUST_NOT_BLOCK = [
  'ddtrace-run pytest',
  'git clean -n',
  'git reset --soft HEAD~1',
  'add if=x',
  'go build ./cmd/ddl',
];

test('brief section B: disk-write and git-destructive regex holes are closed', () => {
  for (const [cmd, id] of B_MUST_BLOCK) {
    const r = checkCommand(cmd);
    assert.equal(r.blocked, true, `should block: ${cmd}`);
    assert.equal(r.patternId, id, `wrong pattern for: ${cmd}`);
  }
});

test('brief section B: the fix introduces no new false positives', () => {
  for (const cmd of B_MUST_NOT_BLOCK) {
    assert.equal(checkCommand(cmd).blocked, false, `should allow: ${cmd}`);
  }
});

// --- additional gaps found during this task (not in the 12-rule table as
// originally specified): rm's GNU long-form flags (--recursive/--force) are
// exactly as destructive as -r/-f but the plan's original regex only looked
// for single-dash short flags, so `rm --recursive --force /` sailed straight
// through. Likewise a `>` redirect into /etc/passwd, /etc/shadow, or
// /etc/sudoers is at least as catastrophic as one into a raw disk device
// (locks out every account, or grants one) but the original disk-write
// regex only recognised /dev/* destinations. Both are additions to the
// *existing* destructive-rm / disk-write rule ids -- not new rule ids -- so
// they don't change the module's public surface, only close real holes in
// rules already in scope.
const EXTRA_MUST_BLOCK = [
  ['rm --recursive --force /', 'destructive-rm'],
  ['rm --force -r /', 'destructive-rm'],
  ['rm -v --recursive /path', 'destructive-rm'],
  ['echo pwned > /etc/passwd', 'disk-write'],
  ['echo pwned >> /etc/sudoers', 'disk-write'],
  ['printf x > /etc/shadow', 'disk-write'],
];

const EXTRA_MUST_NOT_BLOCK = [
  // a long-form flag that merely *starts with* "force"/"recursive" is not
  // the real flag -- a naive \b-based match would wrongly fire here just
  // like the section-B bug, since \b holds at a word/hyphen transition too.
  'rm --force-something-fake /path',
  'rm --recursively-fake /path',
  'rm --interactive=once file.txt',
  'rm --preserve-root file.txt',
  'rm -i file.txt',
  'rm file.txt',
  // same trap on the /etc side: a filename that merely starts with
  // "passwd" must not match.
  'echo x > /etc/passwd.bak',
  'echo x > /etc/passwd-old',
  'echo x > /etc/passwd2',
  'cat /etc/passwd',
  'grep root /etc/passwd',
];

test('additional gap found: rm long-form --recursive/--force flags are blocked', () => {
  for (const [cmd, id] of EXTRA_MUST_BLOCK) {
    const r = checkCommand(cmd);
    assert.equal(r.blocked, true, `should block: ${cmd}`);
    assert.equal(r.patternId, id, `wrong pattern for: ${cmd}`);
  }
});

test('additional gap fix introduces no new false positives', () => {
  for (const cmd of EXTRA_MUST_NOT_BLOCK) {
    assert.equal(checkCommand(cmd).blocked, false, `should allow: ${cmd}`);
  }
});

// --- brief section C: --allow must not be able to silently disable the
// rules whose failure mode is irreversible, machine-wide destruction
// (root escalation, recursive/forced delete, raw-disk or system-auth-file
// write). Every other rule remains overridable -- that's the whole point of
// --allow existing as deploy-words' escape hatch.
test('hard rules (sudo, destructive-rm, find-delete, disk-write) cannot be overridden by --allow', () => {
  assert.equal(checkCommand('sudo rm -rf /', [/^sudo rm -rf \/$/]).blocked, true);
  assert.equal(checkCommand('rm -rf /', [/^rm -rf \/$/]).blocked, true);
  assert.equal(checkCommand('find / -delete', [/^find \/ -delete$/]).blocked, true);
  assert.equal(
    checkCommand('dd if=/dev/zero of=/dev/sda', [/^dd if=\/dev\/zero of=\/dev\/sda$/]).blocked,
    true,
  );
});

test('soft rules remain overridable by an exact --allow match', () => {
  assert.equal(checkCommand('shutdown -h now', [/^shutdown -h now$/]).blocked, false);
  assert.equal(checkCommand('git push origin main', [/^git push origin main$/]).blocked, false);
});

test('every DANGEROUS_PATTERNS entry declares hard: true or hard: false explicitly', () => {
  for (const p of DANGEROUS_PATTERNS) {
    assert.equal(typeof p.hard, 'boolean', `${p.id} must declare a boolean hard flag`);
  }
  const hardIds = DANGEROUS_PATTERNS.filter((p) => p.hard).map((p) => p.id).sort();
  assert.deepEqual(hardIds, ['destructive-rm', 'disk-write', 'find-delete', 'sudo']);
});

test('isHardRule reflects the same hard/soft split', () => {
  assert.equal(isHardRule('sudo'), true);
  assert.equal(isHardRule('destructive-rm'), true);
  assert.equal(isHardRule('find-delete'), true);
  assert.equal(isHardRule('disk-write'), true);
  assert.equal(isHardRule('deploy-words'), false);
  assert.equal(isHardRule('git-push'), false);
  assert.equal(isHardRule('not-a-real-id'), false);
  // round 3: 'empty' and 'too-long' are non-overridable in fact (checkCommand
  // never evaluates allowPatterns for either), so isHardRule must say so.
  assert.equal(isHardRule('empty'), true);
  assert.equal(isHardRule('too-long'), true);
});

// --- brief section C: the caller (Task 18's verify) needs to be able to
// report "this would have been blocked by X, but --allow explicitly
// permitted it" -- that information must survive an override, not just
// disappear into blocked: false.
test('overriding a soft rule reports which rule would have fired', () => {
  const r = checkCommand('make deploy', [/^make deploy$/]);
  assert.equal(r.blocked, false);
  assert.equal(r.overriddenBy, 'deploy-words');
});

test('a genuinely safe command has no overriddenBy (nothing was overridden)', () => {
  const r = checkCommand('go test ./...');
  assert.equal(r.blocked, false);
  assert.equal(r.overriddenBy, null);
});

test('a blocked command (no matching allow) has no overriddenBy', () => {
  const r = checkCommand('git push origin main');
  assert.equal(r.blocked, true);
  assert.equal(r.overriddenBy, null);
});

// --- brief section E: patternId: 'empty' must resolve to a reason text too.
test("checkCommand reports patternId 'empty' for blank input", () => {
  assert.equal(checkCommand('').patternId, 'empty');
  assert.equal(checkCommand('   ').patternId, 'empty');
  assert.equal(checkCommand(undefined).patternId, 'empty');
  assert.equal(checkCommand(null).patternId, 'empty');
});

test('every patternId checkCommand can ever return resolves to a reason text in both languages', () => {
  const allIds = [...DANGEROUS_PATTERNS.map((p) => p.id), 'empty', 'too-long'];
  for (const id of allIds) {
    const key = reasonKeyFor(id);
    assert.ok(typeof key === 'string' && key.length > 0, `${id} must have a resolvable reasonKey`);
    assert.doesNotThrow(() => t(key, 'en'), `${id}: missing en text for ${key}`);
    assert.doesNotThrow(() => t(key, 'zh'), `${id}: missing zh text for ${key}`);
    assert.notEqual(t(key, 'en'), '', `${id}: en text must not be empty`);
    assert.notEqual(t(key, 'zh'), '', `${id}: zh text must not be empty`);
  }
});

test('reasonKeyFor returns null for an id that does not exist', () => {
  assert.equal(reasonKeyFor('not-a-real-id'), null);
});

test('deploy-words reason text says the rule is deliberately broad', () => {
  const key = reasonKeyFor('deploy-words');
  // Not asserting exact prose (that would pin translation wording), just
  // that the "this is intentionally over-broad" framing survives in both
  // languages, per brief section D.
  assert.match(t(key, 'en').toLowerCase(), /deliberately broad|intentional/);
  assert.match(t(key, 'zh'), /故意|有意/);
});

test('hard-rule reason text says --allow cannot override it', () => {
  for (const id of ['sudo', 'destructive-rm', 'find-delete', 'disk-write', 'too-long']) {
    const key = reasonKeyFor(id);
    assert.match(t(key, 'en'), /--allow/);
    assert.match(t(key, 'zh'), /--allow/);
  }
});

// --- brief section F, point 2: none of the patterns may carry a /g flag,
// since RegExp#test on a /g regex mutates lastIndex, making the same
// pattern object give different answers on successive calls against the
// same string.
test('no DANGEROUS_PATTERNS regex carries the g flag', () => {
  for (const p of DANGEROUS_PATTERNS) {
    assert.ok(!p.re.global, `${p.id} regex must not have the g flag`);
  }
});

test('checking the same command twice in a row gives the same answer (no lastIndex drift)', () => {
  const cmd = 'rm -rf /tmp/x';
  const first = checkCommand(cmd);
  const second = checkCommand(cmd);
  assert.deepEqual(first, second);
  // and a third time, and interleaved with an unrelated command, for good
  // measure -- a /g-flag regression would show up intermittently depending
  // on call order, not on every single call.
  assert.equal(checkCommand('go test ./...').blocked, false);
  const third = checkCommand(cmd);
  assert.deepEqual(third, first);
});

// --- brief section F, point 1: the nested quantifier in destructive-rm's
// flag-group -- (?:(?:-[a-zA-Z]*|--[a-zA-Z][a-zA-Z-]*)\s+)* -- is the kind of
// shape that causes catastrophic backtracking in naive engines when a
// quantified group's own contents are themselves quantified. Empirically
// measured (see task-16-report.md) at up to 300,000 chars with linear
// scaling and no blowup, because each repetition is anchored by a mandatory
// literal '-' and a mandatory trailing \s+ that the next repetition's '-'
// can't also claim -- there is no ambiguous re-partitioning of the same
// substring across iterations for the engine to explore. This test pins
// that property with a hard wall-clock budget so a future edit that
// reintroduces ambiguity (e.g. removing the mandatory \s+) fails loudly
// instead of just getting slower in CI.
test('destructive-rm and disk-write patterns do not catastrophically backtrack on adversarial input', () => {
  const adversarial = [
    `rm ${'-a '.repeat(50000)}x`,
    `rm ${'--verbose '.repeat(50000)}x`,
    `dd ${'x'.repeat(200000)}`,
    `curl ${'x'.repeat(200000)}`,
  ];
  const budgetMs = 500;
  for (const cmd of adversarial) {
    const start = Date.now();
    checkCommand(cmd);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < budgetMs, `checkCommand took ${elapsed}ms on adversarial input (len ${cmd.length}) — possible catastrophic backtracking`);
  }
});

// --- round 2 (coordinator review, fix base 34d3c08): `[^;&|]*` between two
// anchors is a different shape than round 1's nested quantifiers and was
// re-measured from scratch rather than assumed safe by analogy -- it has
// no ambiguous re-partitioning to exploit (it's a single bounded scan, not
// a repeated group with its own internal quantifier), but every rule that
// now uses this shape gets its own adversarial probe here so a future edit
// that combines it with something backtracking-prone fails loudly.
// Round 3 superseded this test's original premise: every one of its inputs
// was ~200k-300k characters, which is now well over MAX_COMMAND_LENGTH
// (2048) and gets rejected in O(1) by the length check before any regex
// ever runs -- so as originally written, this test would keep passing for
// the wrong reason (the length cap short-circuiting it) even if the
// [\s\S]* regexes it's meant to guard were reintroduced with a genuine
// quadratic blowup *below* the cap. Shrunk every input to comfortably
// under the cap so this test actually exercises the regex engine, the
// thing it claims to test; the over-the-cap regime has its own dedicated
// round-3 tests below (length-cap-rejection-is-O(1), and the
// restart-point curve at sizes up to and including the cap itself).
test('the [\\s\\S]* tool/subcommand rules do not catastrophically backtrack on adversarial input below the length cap', () => {
  const budgetMs = 200;
  const adversarial = [
    `git ${'x'.repeat(1900)}`,
    `git ${'a '.repeat(600)}push`,
    `git clean ${'-a'.repeat(900)}z`,
    `kubectl ${'x'.repeat(1900)}`,
    `docker ${'x'.repeat(1900)}`,
    `terraform ${'x'.repeat(1900)}`,
    `helm ${'x'.repeat(1900)}`,
    `npm ${'x'.repeat(1900)}`,
    `cargo ${'x'.repeat(1900)}`,
    `find ${'x'.repeat(1900)}`,
    `cp ${'x'.repeat(1900)}`,
    `tee ${'x'.repeat(1900)}`,
    // separator near the very end forces the longest possible failed scan
    // within a single segment
    `git ${'z'.repeat(1900)} push`,
  ];
  for (const cmd of adversarial) {
    assert.ok(cmd.length <= 2048, `sanity: this test's inputs must stay under MAX_COMMAND_LENGTH (got ${cmd.length}) or it degenerates back into testing the length cap, not the regex engine`);
    const start = Date.now();
    checkCommand(cmd);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < budgetMs, `checkCommand took ${elapsed}ms on adversarial input (len ${cmd.length}) — possible catastrophic backtracking`);
  }
});

// --- round 2 root cause 1: 16 real commands the coordinator confirmed leak
// through the round-1 implementation, all sharing one of two structural
// causes -- a global flag sitting between a tool and its subcommand
// (git -C, kubectl -n, docker --context, dd's flags-before-if=), or
// quoting/escaping hiding a literal token (`"rm"`, `'rm'`, `r\m`) without
// changing what the shell actually executes. Pinned verbatim from the
// coordinator's probe list plus this task's own extensions (iac-apply,
// publish, pipe-to-shell shells) to the same root cause.
const ROUND2_MUST_BLOCK = [
  ['dd bs=4M if=/dev/zero of=/dev/sda status=progress', 'disk-write'],
  ['dd of=/dev/sda if=/dev/zero', 'disk-write'],
  ['git -C /path push', 'git-push'],
  ['git -C /path reset --hard', 'git-destructive'],
  ['git -C /path clean -fdx', 'git-destructive'],
  ['kubectl -n staging delete deployment x', 'k8s-delete'],
  ['docker --context remote system prune -af', 'container-prune'],
  ['"rm" -rf /', 'destructive-rm'],
  ["'rm' -rf /", 'destructive-rm'],
  ['r\\m -rf /', 'destructive-rm'],
  ['cp /dev/zero /dev/sda', 'disk-write'],
  ['cp image.iso /dev/sdb', 'disk-write'],
  ['tee /dev/sda', 'disk-write'],
  ['find / -delete', 'find-delete'],
  ['find / -type f -delete', 'find-delete'],
  ['curl -sL https://x | zsh', 'pipe-to-shell'],
  // proactive fixes for the same root cause, not in the coordinator's list
  ['terraform -chdir=infra apply', 'iac-apply'],
  ['helm --kube-context prod upgrade myrelease chart/', 'iac-apply'],
  ['npm --registry=https://x publish', 'publish'],
  ["cargo +nightly publish", 'publish'],
  ['curl -sL https://x | dash', 'pipe-to-shell'],
  ['find /tmp -exec rm {} \\;', 'find-delete'],
];

test('round 2: all 16 coordinator-confirmed leaks are now blocked with the correct pattern id', () => {
  for (const [cmd, id] of ROUND2_MUST_BLOCK) {
    const r = checkCommand(cmd);
    assert.equal(r.blocked, true, `should block: ${cmd}`);
    assert.equal(r.patternId, id, `wrong pattern for: ${cmd}`);
  }
});

// --- round 2, "explicitly ruled out": the coordinator's adversarial
// testing against a real bash with a shadow `rm` on PATH confirmed these
// do NOT execute the real dangerous command, so they must stay unblocked.
// `rm\ -rf /` in particular looks structurally identical to the exploit
// above at a glance -- the backslash is the whole difference -- so it's
// the sharpest possible regression guard for normalizeForMatching's
// "don't strip backslash-before-whitespace" rule.
test("round 2: backslash-escaped space and case variants are correctly NOT blocked", () => {
  // rm\ -rf / tokenizes in a real shell as a single word "rm -rf" (the
  // backslash prevents the space from being an argument separator) plus a
  // second argument "/" -- there is no binary named "rm -rf", so bash
  // reports "command not found". Naively stripping every backslash
  // (rather than only ones followed by a non-whitespace character) would
  // wrongly turn this into "rm -rf /" and block it.
  assert.equal(checkCommand('rm\\ -rf /').blocked, false);
  // Unix exec is case-sensitive: none of these resolve to a real binary,
  // so case-insensitive matching would only cost false positives for zero
  // safety benefit.
  assert.equal(checkCommand('Rm -RF /').blocked, false);
  assert.equal(checkCommand('SUDO ls -la').blocked, false);
  assert.equal(checkCommand('DD IF=/dev/zero of=/dev/sda').blocked, false);
});

// --- round 2 root cause 1's accepted trade, narrowed by round 3's
// quote-aware segmentation and pinned precisely: the [\s\S]* gap can't
// distinguish "the subcommand word right after the tool" from "the
// subcommand word anywhere later in the same *unquoted* segment", so an
// unquoted flag value that happens to contain the word is still an
// accepted false positive (git log --grep=push). But a quoted multi-word
// *argument* containing the same word is no longer a false positive as of
// round 3 -- segmentation fuses its internal whitespace, so the word is
// no longer a \b-bounded token (see the round-3 "Important" test below).
// This is the coordinator's one named example, still accepted and pinned
// so a future change can't silently widen the trade back out.
test('round 2 accepted trade (narrowed by round 3): an unquoted flag value containing the subcommand word still false-positives', () => {
  assert.equal(checkCommand('git log --grep=push').blocked, true);
  assert.equal(checkCommand('kubectl get pods -l app=to-delete').blocked, true);
});

// --- round 3, Critical 1: a separator character *inside quotes* is
// ordinary argument content to the shell, not a boundary -- `-C`'s
// argument in `git -C ";" push` really is the literal string ";", and the
// whole line is one real git invocation. A character-class gap has no
// concept of quote state and stopped the scan at the quoted separator;
// coordinator-confirmed as genuine, executing single invocations. Two of
// these are hard rules, reachable without even needing --allow.
const ROUND3_QUOTED_SEPARATOR_MUST_BLOCK = [
  ['git -C ";" push origin main', 'git-push'],
  ['git -C ";" reset --hard HEAD', 'git-destructive'],
  ['kubectl -n ";" delete deployment x', 'k8s-delete'],
  ['docker --context ";" system prune -af', 'container-prune'],
  ['find "a;b" -delete', 'find-delete'],
  ['cp "a;b" /dev/sda', 'disk-write'],
];

test('round 3 Critical 1: a separator hidden inside quotes no longer defeats the tool/subcommand rules', () => {
  for (const [cmd, id] of ROUND3_QUOTED_SEPARATOR_MUST_BLOCK) {
    const r = checkCommand(cmd);
    assert.equal(r.blocked, true, `should block: ${cmd}`);
    assert.equal(r.patternId, id, `wrong pattern for: ${cmd}`);
  }
});

// --- round 3, the "Important" fix folded in alongside the two Criticals:
// quote-aware segmentation can tell "a quoted single word used as the
// command token" (still a real token once dequoted) apart from "a
// multi-word quoted argument that happens to contain a dangerous-looking
// substring" (fused into one non-\b-bounded blob, not individually
// matchable words) -- something round 2's lossy quote-stripping could not
// do. `git log --grep=push` above (unquoted) is still an accepted false
// positive; these quoted-argument cases are not, as of this round.
test('round 3 Important: a dangerous-looking word inside a quoted multi-word argument no longer false-positives', () => {
  assert.equal(checkCommand('echo "don\'t rm -rf things"').blocked, false);
  assert.equal(checkCommand("grep 'git push' log.txt").blocked, false);
  assert.equal(checkCommand('git commit -m "add push support"').blocked, false);
});

// --- round 3, Critical 2: [^;&|]*/[\s\S]* between two anchors is O(n) per
// candidate start position for the first anchor, and a short anchor like
// \bgit\b can occur O(n) times with the subcommand never resolving --
// O(n) x O(n) = O(n^2). Segmenting alone does not fix this (a pathological
// input with no real separator at all is still exactly one segment as
// long as the whole input); MAX_COMMAND_LENGTH is the actual fix. Multiple
// sizes, not one number -- the coordinator's own instruction was not to
// assume a single measurement generalizes.
test('round 3 Critical 2: commands over the length cap are refused in O(1), never reaching the vulnerable regexes', () => {
  const overCap = 'git '.repeat(600) + 'x'; // > 2048 chars
  assert.ok(overCap.length > 2048, 'sanity: adversarial input must exceed the cap for this test to mean anything');
  const start = Date.now();
  const r = checkCommand(overCap);
  const elapsed = Date.now() - start;
  assert.equal(r.blocked, true);
  assert.equal(r.patternId, 'too-long');
  assert.ok(elapsed < 20, `length-capped rejection took ${elapsed}ms -- should be O(1), not proportional to input size`);
});

test('round 3 Critical 2: --allow cannot override too-long, and is never even evaluated against it', () => {
  const overCap = 'git '.repeat(600) + 'x';
  // an allow pattern that would clearly match if it were ever evaluated
  const r = checkCommand(overCap, [/git/]);
  assert.equal(r.blocked, true);
  assert.equal(r.patternId, 'too-long');
  assert.equal(isHardRule('too-long'), true);
});

test('round 3 Critical 2: the restart-point adversarial shape stays fast at multiple sizes below and at the cap', () => {
  // The coordinator's own finding: round 2's backtracking test measured a
  // *different* shape (long filler plus one real occurrence) and missed
  // this one (many restart points, subcommand never appearing) entirely.
  // Report the curve, not a single number, and cover every rule that
  // shares this vulnerable shape, not just git.
  const budgetMs = 200;
  const sizes = [256, 512, 1024, 2048]; // 2048 is MAX_COMMAND_LENGTH itself
  for (const tool of ['git', 'kubectl', 'docker', 'terraform', 'helm', 'npm', 'cargo', 'find', 'cp', 'tee']) {
    for (const size of sizes) {
      const prefix = `${tool} `;
      const reps = Math.floor(size / prefix.length);
      const cmd = prefix.repeat(reps) + 'x';
      const start = Date.now();
      checkCommand(cmd);
      const elapsed = Date.now() - start;
      assert.ok(
        elapsed < budgetMs,
        `${tool} at len ${cmd.length} took ${elapsed}ms -- possible quadratic regression (restart-point shape)`,
      );
    }
  }
});

test('round 2: [^;&|]* rules still stop at a shell separator, so piped/chained commands are not blocked', () => {
  assert.equal(checkCommand('git status | grep push').blocked, false);
  assert.equal(checkCommand('echo hello && git status').blocked, false);
  assert.equal(checkCommand('kubectl get pods | grep delete').blocked, false);
  assert.equal(checkCommand('docker ps | grep system').blocked, false);
});

// --- round 2 root cause 3: missing coverage that isn't a quoting or
// adjacency bypass, just a rule that never existed for this shape of
// command.
test('round 2: cp/tee writes to a raw device do not false-positive on ordinary file operations', () => {
  for (const cmd of [
    'cp file1.txt file2.txt',
    'cp -r src/ dist/',
    'tee /tmp/log.txt',
    'tee -a /var/log/app.log',
    'cp /dev/null somefile',
  ]) {
    assert.equal(checkCommand(cmd).blocked, false, `should allow: ${cmd}`);
  }
});

test('round 2: find-delete does not false-positive on ordinary find usage', () => {
  for (const cmd of [
    "find . -name '*.tmp' -print",
    'find . -newer x',
    'find . -exec echo {} \\;',
  ]) {
    assert.equal(checkCommand(cmd).blocked, false, `should allow: ${cmd}`);
  }
});

test('round 2: disk-write no longer requires if= adjacent to dd, but still excludes ddtrace-run/add/ddl', () => {
  for (const cmd of ['ddtrace-run pytest', 'add if=x', 'go build ./cmd/ddl']) {
    assert.equal(checkCommand(cmd).blocked, false, `should allow: ${cmd}`);
  }
});

test('DANGEROUS_PATTERNS order guarantees sudo is reported before destructive-rm', () => {
  const sudoIdx = DANGEROUS_PATTERNS.findIndex((p) => p.id === 'sudo');
  const rmIdx = DANGEROUS_PATTERNS.findIndex((p) => p.id === 'destructive-rm');
  assert.ok(sudoIdx < rmIdx, 'sudo must be checked before destructive-rm so "sudo rm -r x" reports sudo');
});

// --- code-quality review, minor 2: only the sudo-before-destructive-rm
// ordering was pinned by a test, even though the *general* property --
// deploy-words is checked last, so any other rule wins when a command
// happens to also contain a deploy-word -- held for every rule tried and
// was never itself protected by a test. This is exactly the kind of
// Array.find ordering property a later insert could silently break (e.g.
// a new rule id added after deploy-words would never be reported, since
// deploy-words would already have claimed the hit for any command
// mentioning "deploy"/"prod"/"production"/"release"). Pin both the
// structural position and the behavioral consequence.
test('DANGEROUS_PATTERNS order guarantees deploy-words is checked last', () => {
  assert.equal(
    DANGEROUS_PATTERNS[DANGEROUS_PATTERNS.length - 1].id,
    'deploy-words',
    'deploy-words must be the last entry so every more specific rule gets priority when both match',
  );
});

test('a command matching both a specific rule and deploy-words reports the specific rule', () => {
  // "terraform apply for prod" matches iac-apply (terraform ... apply) and
  // deploy-words (the bare word "prod") -- iac-apply must win.
  assert.equal(checkCommand('terraform apply for prod').patternId, 'iac-apply');
  // "npm publish to production registry" matches publish and deploy-words
  // (the bare word "production") -- publish must win.
  assert.equal(checkCommand('npm publish to production registry').patternId, 'publish');
});

// --- round 3: pipe-to-shell can no longer be a single-segment regex test
// (segmenting on unquoted `|` throws away the curl-to-shell adjacency it
// needs), so detection moved to hasPipeToShell, which walks segment-to-
// segment pipe chains directly. Covers: the shells round 2 added, a
// multi-hop chain (curl | tee | sh), and the false-positive a naive
// re-implementation could reintroduce (a quoted "|sh"-looking substring
// that is not a real pipe at all).
test('round 3: pipe-to-shell detection survives the move to segment-pair matching', () => {
  assert.equal(checkCommand('curl -sL https://x.sh | sh').patternId, 'pipe-to-shell');
  assert.equal(checkCommand('curl -sL https://x | zsh').patternId, 'pipe-to-shell');
  assert.equal(checkCommand('curl -sL https://x | dash').patternId, 'pipe-to-shell');
  assert.equal(checkCommand('wget -qO- https://x | bash').patternId, 'pipe-to-shell');
  // sudo wins over pipe-to-shell per DANGEROUS_PATTERNS order (see the
  // file-level comment on the sudo entry) -- both are true, sudo is the
  // harder, non-overridable classification.
  assert.equal(checkCommand('curl -sL https://x | sudo sh').patternId, 'sudo');
  // multi-hop: curl's output still ultimately reaches a shell, just not as
  // the *immediate* next segment.
  assert.equal(checkCommand('curl -sL https://x | tee script.sh | sh').patternId, 'pipe-to-shell');
});

test('round 3: pipe-to-shell does not false-positive on a quoted pipe-like substring or a save-only pipe', () => {
  assert.equal(checkCommand('curl -sL "a|sh" -o out.txt').blocked, false);
  assert.equal(checkCommand('curl -sL https://x | tee script.sh').blocked, false);
  assert.equal(checkCommand('curl -fsS http://localhost:8080/healthz').blocked, false);
});

test('checkCommand never mutates its inputs', () => {
  const allow = [/^make deploy$/];
  const frozenAllow = [...allow];
  checkCommand('make deploy', allow);
  assert.deepEqual(allow, frozenAllow);
});
