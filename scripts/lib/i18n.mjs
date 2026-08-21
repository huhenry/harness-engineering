import { CliError } from './cli.mjs';

export const SUPPORTED_LANGS = ['en', 'zh'];

export const MESSAGES = {
  en: {
    'subsystem.instructions': 'Instructions',
    'subsystem.tools': 'Tools',
    'subsystem.environment': 'Environment',
    'subsystem.state': 'State',
    'subsystem.feedback': 'Feedback',
    'subsystem.loop': 'Loop',
    'report.score': 'Score: {total} / {max}',
    'report.level': 'Level: L{id} {name}',
    'report.title': 'Harness Assessment Report',
    'report.needsEvidence': 'capped — run `verify --run` for evidence',
    'report.noGaps': 'No gaps found.',
    'report.suppressedHigh': 'High-severity gaps counted but not shown: {count}. Each one presupposes a gap that IS shown ({titles}), so start there — but they count toward assess\'s exit code all the same, and --json lists every one of them tagged with suppressedBy.',
    'report.gapsHeading': 'Gaps by ROI',
    'report.subsystemsHeading': 'Subsystem Scores',
    'report.colSubsystem': 'Subsystem',
    'report.colScore': 'Score',
    'report.colStatus': 'Status',
    'report.why': 'Why: {text}',
    'report.fix': 'Fix: {text}',
    'report.evidenceNote': 'Evidence: {text}',

    // --- evidence freshness reasons ---
    'evidence.reason.missing': 'No verify evidence found — run `verify --run` to generate `.harness/verify-report.json`.',
    'evidence.reason.schemaMismatch': 'The verify report has an unsupported schema version and was ignored — run `verify --run` again with the current tool version to regenerate it.',
    'evidence.reason.invalidTimestamp': 'The verify report has an invalid or future-dated timestamp and was ignored (check for clock skew, or a hand-edited file) — run `verify --run` again to produce a trustworthy one.',
    'evidence.reason.stale': 'The verify report is older than 24 hours and was ignored — run `verify --run` again for fresh evidence.',
    'evidence.reason.failed': 'The verify report is fresh and valid, but the run did not pass, so it does not count as evidence — get it green first.',

    // --- maturity levels ---
    'level.0': 'Ad-hoc',
    'level.1': 'Instructed',
    'level.2': 'Reproducible',
    'level.3': 'Continuous',
    'level.4': 'Evidence-backed',
    'level.5': 'Loop-ready',

    // --- gap catalogue: instructions ---
    'gap.instructions.missing.title': 'No AGENTS.md or CLAUDE.md',
    'gap.instructions.missing.why': 'Agents start every session with zero project context and re-derive the stack, entry points and constraints from scratch.',
    'gap.instructions.missing.fix': 'Add a root AGENTS.md (<=150 lines) covering purpose, stack with versions, setup commands and hard constraints.',
    'gap.instructions.no-stack-versions.title': 'Stack versions not pinned in instructions',
    'gap.instructions.no-stack-versions.why': 'Without pinned versions, the agent assumes the API surface it remembers from training and writes code against the wrong version — e.g. treating Next.js 16 as the Next.js it already knows.',
    'gap.instructions.no-stack-versions.fix': 'State the exact version of every major stack component (runtime, framework, key libraries) directly in the instructions file.',
    'gap.instructions.no-setup-commands.title': 'No setup commands in instructions',
    'gap.instructions.no-setup-commands.why': 'Without documented setup commands, the agent has to trial-and-error its way to a working install, burning turns and sometimes leaving a half-configured environment behind.',
    'gap.instructions.no-setup-commands.fix': 'List the exact install, build, test and run commands in the instructions file, in the order they must run.',
    'gap.instructions.no-constraints.title': 'No constraints section',
    'gap.instructions.no-constraints.why': 'Without an explicit constraints section, the agent has no way to know which files, patterns or actions are off-limits, and will violate rules it was never told about.',
    'gap.instructions.no-constraints.fix': 'Add a dedicated Constraints section listing hard rules — forbidden files, required patterns, non-negotiables.',
    'gap.instructions.no-verification.title': 'No verification section in instructions',
    'gap.instructions.no-verification.why': "Without a documented way to verify its own work, the agent has no way to prove a change actually works, and any claim that it's done is just an assertion.",
    'gap.instructions.no-verification.fix': 'Add a Verification section listing the exact commands that prove a change works — the ones to run before calling anything done.',
    'gap.instructions.too-long.title': 'Instructions file too long',
    'gap.instructions.too-long.why': 'An overlong instructions file dilutes attention — the constraints and commands that matter most get buried and forgotten partway through a session.',
    'gap.instructions.too-long.fix': 'Trim the root file to the essentials and move deep-dive detail into linked sub-documents.',
    'gap.instructions.no-layering.title': 'No layered instructions for subprojects',
    'gap.instructions.no-layering.why': 'In a multi-module repository, a single flat instructions file forces one set of conventions onto every subproject, and module-specific rules never surface.',
    'gap.instructions.no-layering.fix': 'Add a nested AGENTS.md or CLAUDE.md inside each subproject describing conventions local to that module.',
    'gap.instructions.stale-links.title': 'Instructions reference stale links',
    'gap.instructions.stale-links.why': "The agent follows the paths and links stated in the instructions; when they're stale it hits dead ends or silently works from outdated assumptions.",
    'gap.instructions.stale-links.fix': 'Audit every file path and link in the instructions and fix or remove the ones that no longer resolve.',

    // --- gap catalogue: tools ---
    'gap.tools.no-entrypoint.title': 'No canonical entrypoint',
    'gap.tools.no-entrypoint.why': 'Without one canonical entrypoint, the agent has to rediscover per-subsystem build/test/run commands from scratch every session, and there is no single command to trust.',
    'gap.tools.no-entrypoint.fix': 'Add a Makefile (or equivalent) exposing standard targets — setup, build, test, run — as the one entrypoint agents call.',
    'gap.tools.broken-entrypoint.title': 'Entrypoint command fails',
    'gap.tools.broken-entrypoint.why': 'The agent trusts the declared entrypoint; when it fails on invocation, the agent burns time diagnosing broken tooling instead of doing the actual task.',
    'gap.tools.broken-entrypoint.fix': 'Run every declared entrypoint command from a clean checkout and fix whichever ones fail.',
    'gap.tools.no-permissions.title': 'No tool permissions config',
    'gap.tools.no-permissions.why': 'Without a permissions config, every command or tool the agent invokes triggers a manual approval prompt, which kills any chance of autonomous operation.',
    'gap.tools.no-permissions.fix': 'Add a .claude/settings.json (or equivalent) that allowlists the safe, repeatedly-used commands and tools.',
    'gap.tools.no-least-privilege-doc.title': 'No least-privilege documentation',
    'gap.tools.no-least-privilege-doc.why': 'Without a documented line between safe and dangerous actions, the agent either over-asks for permission on harmless commands or, worse, runs destructive ones unsupervised.',
    'gap.tools.no-least-privilege-doc.fix': 'Document which tools are auto-approved, which need confirmation, and which are forbidden outright.',

    // --- gap catalogue: environment ---
    'gap.environment.no-lockfile.title': 'No lockfile',
    'gap.environment.no-lockfile.why': "Without a lockfile, dependency installs are not reproducible — the agent's environment can silently drift from what CI or other machines actually run.",
    'gap.environment.no-lockfile.fix': "Generate and commit the stack's lockfile (e.g. run `npm install` or `go mod tidy`) so every install is reproducible.",
    'gap.environment.no-runtime-pin.title': 'No runtime version pin',
    'gap.environment.no-runtime-pin.why': "Without a pinned runtime version, the agent's installed toolchain may not match what the project actually needs, causing build or test failures that have nothing to do with the code change.",
    'gap.environment.no-runtime-pin.fix': "Add the stack's runtime pin file (e.g. .nvmrc, .python-version) set to the exact version the project uses.",
    'gap.environment.no-bootstrap.title': 'No bootstrap script',
    'gap.environment.no-bootstrap.why': 'Without a bootstrap script, the agent has to reconstruct the setup sequence from scattered docs every session, and an early mistake derails the entire task.',
    'gap.environment.no-bootstrap.fix': 'Add an init.sh (or equivalent) that installs dependencies and prepares the environment with a single command.',
    'gap.environment.bootstrap-fails.title': 'Bootstrap script fails',
    'gap.environment.bootstrap-fails.why': 'When the documented bootstrap step itself errors out, every downstream command the agent runs inherits a broken environment.',
    'gap.environment.bootstrap-fails.fix': 'Run the bootstrap script against a clean checkout and fix whatever breaks until it exits cleanly.',
    'gap.environment.no-container.title': 'No containerized dev environment',
    'gap.environment.no-container.why': "Without a containerized definition, the agent's environment depends on whatever happens to already be installed on the host, and failures differ from machine to machine.",
    'gap.environment.no-container.fix': 'Add a .devcontainer/devcontainer.json (or Dockerfile) that reproduces the dev environment from a clean base image.',

    // --- gap catalogue: state ---
    'gap.state.no-progress.title': 'No progress file',
    'gap.state.no-progress.why': "Without a progress record, a new or resumed session can't tell what's already done, and ends up repeating finished work or picking up mid-task blind.",
    'gap.state.no-progress.fix': 'Add a PROGRESS.md that the agent updates after every meaningful step, recording what\'s done and what\'s next.',
    'gap.state.progress-stale.title': 'Progress file is stale',
    'gap.state.progress-stale.why': "A stale progress file is worse than none — the agent trusts it, resumes from the wrong point, and either redoes finished work or skips work that was never actually done.",
    'gap.state.progress-stale.fix': "Update PROGRESS.md at the end of every session, or wire the update into the commit/finish workflow so it can't fall behind.",
    'gap.state.progress-incomplete.title': 'Progress file missing key fields',
    'gap.state.progress-incomplete.why': "A progress file that only logs what already happened, without next steps or open blockers, forces the next session to re-derive its own starting point.",
    'gap.state.progress-incomplete.fix': 'Extend the progress template to always record next steps and open blockers, not just completed items.',
    'gap.state.no-feature-list.title': 'No structured feature list',
    'gap.state.no-feature-list.why': "Without a structured feature list, neither the agent nor an automated checker has a machine-readable source of truth for what's in scope and what's done.",
    'gap.state.no-feature-list.fix': 'Add a feature_list.json, backed by a feature_list.schema.json, enumerating features and their status.',
    'gap.state.feature-list-invalid.title': 'Feature list fails its schema',
    'gap.state.feature-list-invalid.why': "A feature list that fails its own schema breaks any tooling that reads it, and the agent can no longer trust the declared scope of work.",
    'gap.state.feature-list-invalid.fix': 'Validate feature_list.json against feature_list.schema.json and fix entries until it validates clean.',
    'gap.state.no-handoff.title': 'No session handoff doc',
    'gap.state.no-handoff.why': "Missing handoff artefacts: {artefacts}. Without a handoff protocol, context that only ever lived in one session's head disappears the moment that session ends.",
    'gap.state.no-handoff.fix': 'Add {artefacts}, and fill in what actually happened before ending the session.',
    'gap.state.handoff-unfilled.title': 'Handoff doc exists but is still an unfilled template',
    // Deliberately does NOT assert a single reason. The check that fires
    // this gap answers one question -- "does any copy read as filled in?" --
    // and three different states answer it no: an unreplaced FILL: marker,
    // the shipped template carrying nothing but scaffold's own provenance
    // line (byte-identity is compared AFTER that line is stripped, so a
    // scaffolded file is never literally byte-identical), and a file this
    // tool could not read at all. Naming only the first two made the
    // sentence false in the single most common state a user meets this gap
    // in -- a `scaffold --apply`'d clean-state-checklist.md, which has no
    // FILL: marker in either language and is not byte-identical either.
    'gap.state.handoff-unfilled.why': "Handoff artefacts that exist but were never filled in: {artefacts}. Every copy found either still carries an unreplaced FILL: marker, or is this project's shipped template with nothing added but scaffold's own provenance line, or could not be read at all — so nothing on disk records what actually happened.",
    'gap.state.handoff-unfilled.fix': 'Replace every FILL: placeholder and any leftover template text in {artefacts} with what actually happened this session. Re-running scaffold cannot do that — it only ever writes new files and never edits one that already exists, so every path named here would be left exactly as it is. If this tool could not read what is on disk, fix the permissions first.',
    'gap.state.lifecycle-undocumented.title': 'State file lifecycle undocumented',
    'gap.state.lifecycle-undocumented.why': "Without a documented lifecycle, agents don't know when to create, update or retire each state file, so the whole state layer drifts and stops being trustworthy.",
    'gap.state.lifecycle-undocumented.fix': "Document each state file's lifecycle — who updates it, at what point, and when it gets archived or reset.",

    // --- gap catalogue: feedback ---
    'gap.feedback.no-tests.title': 'No test suite',
    'gap.feedback.no-tests.why': 'Without a test suite, neither the agent nor a reviewer has any way to know whether a change actually works.',
    'gap.feedback.no-tests.fix': "Add a minimal test suite covering the project's critical paths, runnable with a single command.",
    'gap.feedback.no-declared-commands.title': 'No declared verification commands',
    'gap.feedback.no-declared-commands.why': 'Without a declared, machine-readable command list, both the agent and any automated verifier have to guess which commands are the real checks.',
    'gap.feedback.no-declared-commands.fix': 'Add a harness.config.json declaring the canonical test, build and lint commands.',
    'gap.feedback.commands-unverified.title': 'Declared commands never verified',
    'gap.feedback.commands-unverified.why': "A declared command that's never actually been run might not even exist or might fail immediately, so an agent's claim of 'tests passed' can't be trusted.",
    'gap.feedback.commands-unverified.fix': 'Run every declared command at least once, capture its output, and fix any that are broken.',
    'gap.feedback.commands-failing.title': 'Declared commands are failing',
    'gap.feedback.commands-failing.why': "A failing baseline means the agent can't tell its own changes from pre-existing breakage, so a red suite stays red indefinitely.",
    'gap.feedback.commands-failing.fix': 'Get the declared commands to a green baseline before layering any new work on top of them.',
    'gap.feedback.single-check-kind.title': 'Only one kind of check exists',
    'gap.feedback.single-check-kind.why': 'A single check kind — for example only unit tests — misses whole classes of defects that only a different kind of check, like lint or type-checking, would catch.',
    'gap.feedback.single-check-kind.fix': 'Add at least one complementary check kind (lint, type-check, or integration tests) alongside the existing one.',
    'gap.feedback.no-ci.title': 'No CI pipeline',
    'gap.feedback.no-ci.why': 'Without CI, checks only run when someone remembers to run them locally, so regressions merge unnoticed.',
    'gap.feedback.no-ci.fix': 'Add a CI workflow that runs the declared commands automatically on every push or pull request.',
    'gap.feedback.no-e2e.title': 'No end-to-end tests',
    'gap.feedback.no-e2e.why': 'Unit tests alone can stay green while the actual running system is broken end-to-end — wiring, integration and real-environment failures slip through.',
    'gap.feedback.no-e2e.fix': 'Add at least one end-to-end test that exercises the system as it actually runs, not just isolated units.',
    'gap.feedback.no-observability.title': 'No observability',
    'gap.feedback.no-observability.why': 'Without observability, failures in the running system stay invisible until a user reports them, and debugging starts from zero every time.',
    'gap.feedback.no-observability.fix': "Add basic structured logging (and metrics or tracing where applicable) to the system's critical paths.",

    // --- safety: dangerous-command blocklist reason texts (task 16) ---
    // Each is a self-contained sentence: what the command does, why that's
    // dangerous, and what the user can do about it — mirroring the
    // evidence.reason.* convention above rather than splitting into
    // separate title/why/fix keys, since safety.mjs's DANGEROUS_PATTERNS
    // has a single `reasonKey` per rule, not the gap catalogue's three.
    // Hard rules (sudo, destructive-rm, disk-write) state plainly that
    // --allow cannot override them; every other rule ends with the
    // override instruction instead.
    'safety.sudo': 'This runs with `sudo` — once a command escalates to root, none of the checks a normal user would trip on are still in effect. This is a hard rule: `--allow` cannot override it. If you are certain the command is safe, run it yourself outside `verify --run`.',
    'safety.destructive-rm': 'This deletes files recursively and/or without confirmation (`-r`, `-f`, `--recursive`, or `--force` on `rm`), and there is no undo once the wrong path gets caught in it. This is a hard rule: `--allow` cannot override it. If you are certain the command is safe, run it yourself outside `verify --run`.',
    'safety.find-delete': 'This recursively deletes every file `find` matches (`-delete`, or `-exec rm ...`), and a search path that is too broad turns it into `rm -rf` for an entire subtree in one command. This is a hard rule: `--allow` cannot override it. If you are certain the command is safe, run it yourself outside `verify --run`.',
    'safety.too-long': 'This command is over 2048 characters — long enough that checking it against every rule here (or against your own `--allow` pattern) could take unpredictable time on adversarial input, so it is refused without being analyzed, rather than risking `verify --run` hanging. `--allow` cannot override this: the whole point is to never run any regex — yours or this module\'s — against input this large. If the command is genuinely safe, run it yourself outside `verify --run`, or split it into shorter declared commands.',
    'safety.unterminated-quote': 'This command has a quote that is never closed, so this module cannot reliably tell where its real argument boundaries are. Rather than guess, it refuses to analyze the command at all — the same principle behind the length cap: an unreliable parse is not something to run any regex against, whether this module\'s own or your `--allow` pattern\'s. `--allow` cannot override this. Fix the unclosed quote, or if you are certain the command is safe, run it yourself outside `verify --run`.',
    'safety.disk-write': 'This writes straight to a raw disk device or overwrites a system authentication file (`mkfs`, `dd if=`, or a redirect into /dev/sd*, /dev/nvme*, /dev/disk*, /etc/passwd, /etc/shadow, or /etc/sudoers) — enough to destroy every file on the machine or lock every account out of it. This is a hard rule: `--allow` cannot override it. If you are certain the command is safe, run it yourself outside `verify --run`.',
    'safety.power': 'This shuts down, reboots, or halts the machine, taking the process running `verify --run` down with it along with everything else on the same host. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.git-push': 'This pushes to a remote and can move or overwrite a branch other people are already relying on. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.git-destructive': 'This throws away local commits or untracked files for good (`git reset --hard`, `git clean -f...`, or `git filter-branch`) — there is no reflog for what `clean` removes. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.container-prune': 'This removes Docker containers, images, or volumes in bulk, and any data that lived only in a deleted volume goes with it. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.k8s-delete': 'This deletes a live Kubernetes resource, which can take a running service down. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.iac-apply': 'This applies or destroys real infrastructure (`terraform apply`/`destroy`, `helm upgrade`/`delete`/`uninstall`), changing or tearing down systems other people are running right now. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.publish': 'This publishes a package or release to a public registry, and there is no unpublishing your way out once someone has already installed it. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.pipe-to-shell': 'This pipes a remote download straight into a shell, so whatever that URL happens to serve at this exact moment runs unread. Override with `--allow` and a pattern matching only this command, once you are sure it should run.',
    'safety.shell-indirection': 'This hands a whole new command line to a shell as a single argument (`sh -c`, `bash -lc`, `eval`, ...), so nothing inside it can be checked by any rule here — this module chose not to look, not that it knows the payload is safe. Override with `--allow` and a pattern matching only this command, once you have actually read the payload yourself and are sure it is safe.',
    'safety.unresolved-binary': "This command's program name comes from a shell expansion (`$(...)`, a backtick substitution, or a `$VAR`/`${VAR}` reference) rather than a literal name, so this module cannot know what will actually run — refused for the same reason as shell indirection: it is declining to guess about something it cannot see, not asserting the result is dangerous. Override with `--allow` and a pattern matching only this command, once you have confirmed what the expansion resolves to and are sure it is safe.",
    'safety.deploy-words': 'This rule is deliberately broad: it fires on the bare words "deploy", "prod", "production", or "release" appearing anywhere in the command, including harmless false positives like a script called `release.sh`. That is intentional — missing a real deployment is worse than one extra confirmation. Override with `--allow` and a pattern matching only this command, once you have confirmed it is safe.',
    'safety.empty': 'The command string is empty or whitespace-only, so there is nothing to run — this points at a broken or missing declaration, not a real command. Fix whatever produced the empty string; there is no dangerous pattern here for `--allow` to override.',

    // --- verify.mjs (task 18): CLI report copy ---
    'verify.title': 'Verify Report',
    'verify.mode.dryRun': 'Mode: dry-run — nothing below was actually executed.',
    'verify.mode.run': 'Mode: run — the commands below were actually executed.',
    'verify.result.passed': 'Result: PASSED',
    'verify.result.failed': 'Result: FAILED',
    'verify.commands.heading': 'Commands',
    'verify.col.role': 'Role',
    'verify.col.command': 'Command',
    'verify.col.status': 'Status',
    'verify.status.planned': 'planned (dry-run — not executed)',
    'verify.status.blocked': 'blocked (refused before execution)',
    'verify.status.passed': 'passed',
    'verify.status.failed': 'failed',
    'verify.status.timeout': 'timeout',
    'verify.blocked.heading': 'Blocked commands',
    // Task-18-brief.md section B3: checkCommand's `overriddenBy` tells the
    // caller "this would have been blocked by rule X, but your --allow
    // pattern let it through" — the whole point of Task 16 returning that
    // field at all. This heading and the warning below make sure that
    // information survives into the human-readable report as something a
    // user would actually notice, not a footnote next to a normal pass.
    'verify.overridden.heading': 'Commands you explicitly allowed past a safety rule',
    'verify.overridden.warning': '`{role}` (`{command}`) would have been blocked by the `{rule}` rule — you explicitly allowed it with --allow, so it ran at your own informed risk.',
    'verify.noCommands.note': 'This repository has no verification commands declared at all. This is not the same as "verified" — there is simply nothing here that could have failed. Add commands under `verify` in harness.config.json and run again.',
    'verify.runHint': 'This was a dry run — nothing above was actually executed. Re-run with --run to actually execute these commands.',
    'verify.reportWritten': 'Evidence written to {path}',

    // --- gap catalogue: loop ---
    'gap.loop.none.title': 'No agentic loop defined',
    'gap.loop.none.why': "Without a defined loop pattern, agent sessions run ad hoc — there's no structure for how work gets proposed, checked or repeated.",
    'gap.loop.none.fix': 'Adopt a documented loop pattern (goal loop, timer loop, or maker-checker loop) matching how the project wants agents to work.',
    'gap.loop.no-entrypoint.title': 'Loop is described but nothing runs it',
    'gap.loop.no-entrypoint.why': 'The docs describe a loop, but nothing in the repository says where it starts — no scheduled workflow, no loop/ documents, no loop field in harness.config.json. Anyone who wants to run it has to reconstruct it from prose, while readers reasonably assume something already runs it.',
    'gap.loop.no-entrypoint.fix': 'Give the loop an entry point. Only one of the three this check accepts actually executes anything — a scheduled CI workflow. The other two, per-pattern documents under loop/ and a loop field in harness.config.json, record where the loop is defined so a person or an agent can find it and start it; they do not run it for you.',
    'gap.loop.no-stop-condition.title': 'No stop condition for the loop',
    'gap.loop.no-stop-condition.why': 'Without an explicit stop condition, an agent loop can run indefinitely or stop arbitrarily — wasting budget in one direction, quitting before the goal is met in the other.',
    'gap.loop.no-stop-condition.fix': 'Define and document the exact condition — pass criteria, target state, or explicit signal — that ends the loop.',
    'gap.loop.no-budget-cap.title': 'No budget cap on the loop',
    'gap.loop.no-budget-cap.why': 'Without a budget cap, a stuck or misbehaving loop can burn unlimited time or money before anyone notices.',
    'gap.loop.no-budget-cap.fix': 'Set and enforce a hard cap on iterations, wall-clock time, or spend for every loop.',
    'gap.loop.no-maker-checker.title': 'No maker-checker separation',
    'gap.loop.no-maker-checker.why': 'When the same agent both makes a change and judges it, self-serving assessments and blind spots slip through unchecked.',
    'gap.loop.no-maker-checker.fix': 'Split the loop into a maker step and an independent checker step, each judged against a shared rubric.',
    'gap.loop.no-rollback.title': 'No rollback mechanism',
    'gap.loop.no-rollback.why': 'Without a rollback path, a bad loop iteration corrupts state permanently, and every later iteration keeps building on top of it.',
    'gap.loop.no-rollback.fix': 'Add a rollback mechanism (e.g. git revert or a snapshot restore) that the loop can invoke when an iteration fails its check.',

    // --- scaffold.mjs (task 20): CLI report copy ---
    'scaffold.title': 'Harness Scaffold',
    'scaffold.mode.dryRun': 'Mode: dry-run — nothing below was actually written. Re-run with --apply to write it.',
    'scaffold.mode.apply': 'Mode: apply — the files below were actually written.',
    'scaffold.noGaps': 'Nothing to scaffold — every scaffoldable gap already has a file in this repository (or --only matched a gap with no scaffoldable templates).',
    'scaffold.planHeading': 'Planned files',
    'scaffold.col.action': 'Action',
    'scaffold.col.target': 'Target',
    'scaffold.col.gap': 'Gap',
    'scaffold.action.create': 'create (no existing file)',
    'scaffold.action.propose': 'propose (existing file left untouched)',
    'scaffold.applyHint': 'This was a dry run — nothing above was actually written. Re-run with --apply to write these files.',
    'scaffold.failure': 'Failed to write {target}: {message}',
    'scaffold.writtenSoFar': 'Already written to disk before this failure (not rolled back): {list}',
  },
  zh: {
    'subsystem.instructions': '指令',
    'subsystem.tools': '工具',
    'subsystem.environment': '环境',
    'subsystem.state': '状态',
    'subsystem.feedback': '反馈',
    'subsystem.loop': '循环',
    'report.score': '得分：{total} / {max}',
    'report.level': '等级：L{id} {name}',
    'report.title': 'Harness 体检报告',
    'report.needsEvidence': '已封顶 —— 跑 `verify --run` 补证据',
    'report.noGaps': '未发现差距。',
    'report.suppressedHigh': '已计入、但没有在这里列出的高危 gap：{count} 条。每一条都以某个已经列出的 gap 为前提（{titles}），所以先从那些入手——但它们照样计入 assess 的退出码，用 --json 能看到全部，每条都带 suppressedBy 标记。',
    'report.gapsHeading': '差距清单（按 ROI 排序）',
    'report.subsystemsHeading': '各子系统得分',
    'report.colSubsystem': '子系统',
    'report.colScore': '得分',
    'report.colStatus': '状态',
    'report.why': '原因：{text}',
    'report.fix': '修复建议：{text}',
    'report.evidenceNote': '证据说明：{text}',

    // --- 证据新鲜度原因 ---
    'evidence.reason.missing': '未找到验证证据——跑一遍 `verify --run` 生成 `.harness/verify-report.json`。',
    'evidence.reason.schemaMismatch': '验证报告的 schema 版本不受支持，已忽略——用当前版本的工具重新跑一遍 `verify --run` 重新生成。',
    'evidence.reason.invalidTimestamp': '验证报告的时间戳无效或晚于当前时间，已忽略（可能是时钟偏差，也可能是文件被手动改过）——重新跑一遍 `verify --run` 生成一份可信的时间戳。',
    'evidence.reason.stale': '验证报告已超过 24 小时，已忽略——重新跑一遍 `verify --run` 获取新证据。',
    'evidence.reason.failed': '验证报告是新鲜且合法的，但本次运行没有通过，因此不算作证据——先跑绿再说。',

    // --- 成熟度等级 ---
    'level.0': '无序',
    'level.1': '有指令',
    'level.2': '可复现',
    'level.3': '可续跑',
    'level.4': '有证据',
    'level.5': '可自主循环',

    // --- gap 目录：instructions ---
    'gap.instructions.missing.title': '缺少 AGENTS.md 或 CLAUDE.md',
    'gap.instructions.missing.why': 'agent 每次开工都是零上下文，技术栈、入口和硬约束全靠现推。',
    'gap.instructions.missing.fix': '在仓库根加一份 AGENTS.md（≤150 行），写清用途、带版本的技术栈、setup 命令与硬约束。',
    'gap.instructions.no-stack-versions.title': '指令文件未标注技术栈版本',
    'gap.instructions.no-stack-versions.why': '指令文件不标注版本号时，agent 会按训练记忆里的旧版本 API 写代码——比如把 Next.js 16 当成自己认识的那个 Next.js。',
    'gap.instructions.no-stack-versions.fix': '在指令文件里把每个关键技术栈组件（运行时、框架、核心依赖）的确切版本号写清楚。',
    'gap.instructions.no-setup-commands.title': '指令文件未写明 setup 命令',
    'gap.instructions.no-setup-commands.why': '指令文件不写 setup 命令时，agent 只能靠试错摸索怎么装环境，既浪费轮次，还可能留下一个装到一半的环境。',
    'gap.instructions.no-setup-commands.fix': '在指令文件里按执行顺序列出确切的安装、构建、测试和运行命令。',
    'gap.instructions.no-constraints.title': '缺少约束（constraints）章节',
    'gap.instructions.no-constraints.why': '没有明确的约束章节时，agent 无从得知哪些文件、写法或操作是禁区，只能违反它从未被告知的规则。',
    'gap.instructions.no-constraints.fix': '加一个专门的约束（Constraints）章节，列出硬性规则——禁止改动的文件、必须遵循的写法、不可妥协的底线。',
    'gap.instructions.no-verification.title': '缺少验证（verification）章节',
    'gap.instructions.no-verification.why': '没有验证方式的说明时，agent 没法证明自己的改动真的有效，所谓"完成"也就只是一句自称。',
    'gap.instructions.no-verification.fix': '加一个验证（Verification）章节，列出能证明改动确实有效的具体命令——收尾前必须先跑一遍的那些。',
    'gap.instructions.too-long.title': '指令文件过长',
    'gap.instructions.too-long.why': '指令文件过长会稀释 agent 的注意力——最重要的约束和命令被埋没在长文里，读到一半就被忘掉。',
    'gap.instructions.too-long.fix': '把根目录指令文件精简到核心内容，把详细说明挪到链接的子文档里。',
    'gap.instructions.no-layering.title': '子项目缺少分层指令文件',
    'gap.instructions.no-layering.why': '在多模块仓库里，只有一份扁平的指令文件会把同一套约定套到所有子项目上，模块专属的规则根本没地方体现。',
    'gap.instructions.no-layering.fix': '在每个子项目目录下加一份嵌套的 AGENTS.md 或 CLAUDE.md，写清该模块的专属约定。',
    'gap.instructions.stale-links.title': '指令文件中的链接已失效',
    'gap.instructions.stale-links.why': 'agent 会按指令文件里写的路径和链接去找东西；链接失效时，它要么撞墙，要么悄悄基于过时的假设继续干活。',
    'gap.instructions.stale-links.fix': '检查指令文件里的每个文件路径和链接，修正或删除已经失效的那些。',

    // --- gap 目录：tools ---
    'gap.tools.no-entrypoint.title': '缺少统一入口命令',
    'gap.tools.no-entrypoint.why': '没有统一入口时，agent 每次开工都要重新翻找各子系统的构建/测试/运行命令，也没有一个可以直接信任的统一命令。',
    'gap.tools.no-entrypoint.fix': '加一个 Makefile（或等价方案），暴露 setup、build、test、run 等标准 target，作为 agent 调用的唯一入口。',
    'gap.tools.broken-entrypoint.title': '入口命令跑不通',
    'gap.tools.broken-entrypoint.why': 'agent 会信任声明的入口命令；一旦调用就报错，agent 就得先花时间排查工具链本身，而不是干正事。',
    'gap.tools.broken-entrypoint.fix': '在干净的检出环境里把每条声明的入口命令都跑一遍，修好跑不通的那些。',
    'gap.tools.no-permissions.title': '缺少工具权限配置',
    'gap.tools.no-permissions.why': '没有权限配置时，agent 每调用一个命令或工具都会触发一次人工确认，自主运行根本无从谈起。',
    'gap.tools.no-permissions.fix': '加一份 .claude/settings.json（或等价配置），把安全且高频使用的命令和工具加入白名单。',
    'gap.tools.no-least-privilege-doc.title': '缺少最小权限说明文档',
    'gap.tools.no-least-privilege-doc.why': '没有文档划清安全操作和危险操作的边界时，agent 要么对无害命令也频繁请求确认，要么在无人盯防的情况下执行了破坏性操作。',
    'gap.tools.no-least-privilege-doc.fix': '写清楚哪些工具自动放行、哪些需要人工确认、哪些完全禁止。',

    // --- gap 目录：environment ---
    'gap.environment.no-lockfile.title': '缺少 lockfile',
    'gap.environment.no-lockfile.why': '没有 lockfile 时依赖安装不可复现——agent 本地的环境可能悄悄偏离 CI 或其他机器上实际运行的版本。',
    'gap.environment.no-lockfile.fix': '生成并提交对应技术栈的 lockfile（比如跑一次 `npm install` 或 `go mod tidy`），让每次安装都可复现。',
    'gap.environment.no-runtime-pin.title': '缺少运行时版本锁定',
    'gap.environment.no-runtime-pin.why': '没有锁定运行时版本时，agent 装的工具链版本可能和项目实际需要的对不上，导致跟代码改动毫无关系的构建或测试失败。',
    'gap.environment.no-runtime-pin.fix': '加上对应技术栈的运行时锁定文件（如 .nvmrc、.python-version），写上项目实际使用的确切版本。',
    'gap.environment.no-bootstrap.title': '缺少环境初始化脚本',
    'gap.environment.no-bootstrap.why': '没有初始化脚本时，agent 每次开工都要从零散的文档里重新拼出安装步骤，早期出错就会拖垮整个任务。',
    'gap.environment.no-bootstrap.fix': '加一个 init.sh（或等价脚本），一条命令装好依赖、配好环境。',
    'gap.environment.bootstrap-fails.title': '环境初始化脚本跑不通',
    'gap.environment.bootstrap-fails.why': '文档里写的初始化步骤本身就报错时，agent 后面跑的每条命令都是建立在一个已经坏掉的环境上。',
    'gap.environment.bootstrap-fails.fix': '在干净的检出环境里跑一遍初始化脚本，修到能干净退出为止。',
    'gap.environment.no-container.title': '缺少容器化开发环境',
    'gap.environment.no-container.why': '没有容器化定义时，agent 的运行环境全看宿主机上碰巧装了什么，不同机器上出的问题也各不相同。',
    'gap.environment.no-container.fix': '加一份 .devcontainer/devcontainer.json（或 Dockerfile），从干净的基础镜像复现开发环境。',

    // --- gap 目录：state ---
    'gap.state.no-progress.title': '缺少进度记录文件',
    'gap.state.no-progress.why': '没有进度记录时，新开的或续接的会话没法判断哪些已经做完，只能重复已完成的工作，或者两眼一抹黑地接着干。',
    'gap.state.no-progress.fix': '加一份 PROGRESS.md，让 agent 每完成一个有意义的步骤就更新一次，记录已完成和下一步。',
    'gap.state.progress-stale.title': '进度文件已过期',
    'gap.state.progress-stale.why': '过期的进度文件比没有还糟——agent 会信任它，从错误的位置续接，要么重做已完成的工作，要么漏掉根本没做完的部分。',
    'gap.state.progress-stale.fix': '每次会话结束时更新 PROGRESS.md，或者把更新动作接进提交/收尾流程，避免它跟不上实际进度。',
    'gap.state.progress-incomplete.title': '进度文件字段不全',
    'gap.state.progress-incomplete.why': '进度文件只记录已经发生的事，不写下一步和悬而未决的阻塞项，下一个会话就得自己重新摸索起点。',
    'gap.state.progress-incomplete.fix': '扩展进度文件模板，始终记录下一步和未解决的阻塞项，而不只是已完成事项。',
    'gap.state.no-feature-list.title': '缺少结构化功能清单',
    'gap.state.no-feature-list.why': '没有结构化功能清单时，agent 和自动化检查工具都没有一份机器可读的、说明范围和完成状态的权威来源。',
    'gap.state.no-feature-list.fix': '加一份 feature_list.json，配上 feature_list.schema.json 作为约束，列出功能项及其状态。',
    'gap.state.feature-list-invalid.title': '功能清单不符合 schema',
    'gap.state.feature-list-invalid.why': '功能清单不符合自己的 schema 时，任何读取它的工具都会出错，agent 也没法再信任清单里声明的工作范围。',
    'gap.state.feature-list-invalid.fix': '用 feature_list.schema.json 校验 feature_list.json，修正条目直到校验通过。',
    'gap.state.no-handoff.title': '缺少会话交接文档',
    'gap.state.no-handoff.why': '缺失的交接产物：{artefacts}。没有交接机制时，只存在于某一次会话脑子里的上下文，会在那次会话结束的瞬间彻底消失。',
    'gap.state.no-handoff.fix': '把 {artefacts} 补上，并在结束会话前写清楚这次实际发生了什么。',
    'gap.state.handoff-unfilled.title': '交接文档存在，但还是没填写的模板',
    // 与 en 同理：这里刻意不断言单一原因，因为触发它的实际状态有三种
    // （未替换的 FILL: 标记、剥掉 scaffold 自己那行溯源注释之后与出厂模板
    // 逐字节相同、以及这个工具根本读不到该文件）。
    'gap.state.handoff-unfilled.why': '存在但没有填写的交接产物：{artefacts}。找到的每一份要么还带着未替换的 FILL: 标记，要么就是本项目的出厂模板、只多了 scaffold 自己加的那行溯源注释，要么这个工具根本读不到它——总之磁盘上没有任何东西记录了实际发生的事。',
    'gap.state.handoff-unfilled.fix': '把 {artefacts} 里每一处 FILL: 占位符和残留的模板文字，换成这次会话实际发生的内容。重新跑 scaffold 做不到这件事——它只会写新文件，从不编辑已经存在的文件，上面点名的每个路径都会原样不动。如果是这个工具读不到文件，先修好它的权限。',
    'gap.state.lifecycle-undocumented.title': '状态文件生命周期未说明',
    'gap.state.lifecycle-undocumented.why': '没有文档说明生命周期时，agent 不知道每份状态文件该在什么时候创建、更新或废弃，整个状态层就会逐渐失真、失去可信度。',
    'gap.state.lifecycle-undocumented.fix': '写清楚每份状态文件的生命周期——谁在什么节点更新它，什么时候归档或重置。',

    // --- gap 目录：feedback ---
    'gap.feedback.no-tests.title': '没有测试套件',
    'gap.feedback.no-tests.why': '没有测试套件时，无论是 agent 还是人工审核，都没法判断一次改动到底有没有真正生效。',
    'gap.feedback.no-tests.fix': '加一套覆盖核心路径的最小测试套件，能用一条命令跑起来。',
    'gap.feedback.no-declared-commands.title': '缺少声明式验证命令',
    'gap.feedback.no-declared-commands.why': '没有声明式的、机器可读的命令列表时，agent 和自动化验证器都只能靠猜哪些命令才是真正的检查。',
    'gap.feedback.no-declared-commands.fix': '加一份 harness.config.json，声明标准的测试、构建、lint 命令。',
    'gap.feedback.commands-unverified.title': '声明的命令从未验证过',
    'gap.feedback.commands-unverified.why': '声明过但从没真正跑过的命令，可能根本不存在，或者一跑就报错——这样 agent 说的"测试通过了"就没法让人信。',
    'gap.feedback.commands-unverified.fix': '把每条声明的命令至少实际跑一次，记录输出，修好跑不通的命令。',
    'gap.feedback.commands-failing.title': '声明的命令当前是失败的',
    'gap.feedback.commands-failing.why': '基线本身就是失败状态时，agent 分不清是自己改坏的还是本来就坏的，红灯会一直亮下去。',
    'gap.feedback.commands-failing.fix': '先让声明的命令都跑绿，再在这个基线上叠加新工作。',
    'gap.feedback.single-check-kind.title': '只有一种检查类型',
    'gap.feedback.single-check-kind.why': '只有一种检查类型（比如只有单元测试）会漏掉整整一类缺陷——那些只有 lint 或类型检查之类的其他检查才能抓到的问题。',
    'gap.feedback.single-check-kind.fix': '在现有检查之外，至少再加一种互补的检查类型（lint、类型检查或集成测试）。',
    'gap.feedback.no-ci.title': '缺少 CI 流水线',
    'gap.feedback.no-ci.why': '没有 CI 时，检查只有在有人记得手动跑的时候才会执行，回归问题会在无人察觉的情况下被合并进去。',
    'gap.feedback.no-ci.fix': '加一条 CI 流水线，在每次 push 或 pull request 时自动跑声明的命令。',
    'gap.feedback.no-e2e.title': '缺少端到端（E2E）测试',
    'gap.feedback.no-e2e.why': '只有单元测试时，即使系统在真实环境里跑起来是坏的——接线、集成、真实环境相关的问题——单元测试也可能一路绿灯。',
    'gap.feedback.no-e2e.fix': '至少加一个端到端（E2E）测试，验证系统实际运行时的行为，而不只是孤立的单元。',
    'gap.feedback.no-observability.title': '缺少可观测性',
    'gap.feedback.no-observability.why': '没有可观测性时，线上系统出问题会一直不被察觉，直到用户反馈，排查也每次都得从零开始。',
    'gap.feedback.no-observability.fix': '在系统的核心路径上加基础的结构化日志（以及适用场景下的指标和链路追踪）。',

    // --- 安全：危险命令阻断清单文案（task 16）---
    // 每条都是一句自洽的话：这条命令做什么、为什么危险、用户能做什么——沿用上面
    // evidence.reason.* 的写法，而不是拆成 gap 目录那种 title/why/fix 三段式，
    // 因为 safety.mjs 的 DANGEROUS_PATTERNS 每条规则只有一个 reasonKey。硬规则
    // （sudo、destructive-rm、disk-write）明确说明 --allow 覆盖不了；其余规则
    // 结尾都给出放行方式。
    'safety.sudo': '这条命令带 `sudo` 执行——一旦提权到 root，普通用户会被拦下的检查在这里全部失效。这是硬规则：`--allow` 无法覆盖。如果你确认这条命令安全，请自己在 `verify --run` 之外手动执行。',
    'safety.destructive-rm': '这条命令会递归删除文件，或者跳过删除确认（`rm` 带 `-r`、`-f`、`--recursive` 或 `--force`），一旦路径写错就没有撤销可言。这是硬规则：`--allow` 无法覆盖。如果你确认这条命令安全，请自己在 `verify --run` 之外手动执行。',
    'safety.find-delete': '这条命令会递归删除 `find` 匹配到的每一个文件（`-delete`，或者 `-exec rm ...`），搜索路径一旦写宽了，效果就跟对整个子树跑一次 `rm -rf` 没什么两样。这是硬规则：`--allow` 无法覆盖。如果你确认这条命令安全，请自己在 `verify --run` 之外手动执行。',
    'safety.too-long': '这条命令超过 2048 个字符——长到如果拿它去过一遍这里的每条规则（或者你自己写的 `--allow` 正则），在构造出来的极端输入上可能耗时不可预测，所以直接拒绝、根本不分析，而不是冒着让 `verify --run` 卡死的风险。`--allow` 在这里也覆盖不了：这条规则存在的意义就是不管是这个模块自己的正则还是你写的正则，都不该对这么大的输入跑一遍。如果你确认这条命令确实安全，请自己在 `verify --run` 之外手动执行，或者把它拆成更短的声明命令。',
    'safety.unterminated-quote': '这条命令里有一个引号没有闭合，这个模块没法可靠地判断真正的参数边界在哪。与其瞎猜，不如干脆拒绝分析——这跟长度上限背后的道理是一样的：解析结果都靠不住了，就不该再拿它去跑任何正则，不管是这个模块自己的还是你写的 `--allow` 正则。`--allow` 在这里也覆盖不了。请把没闭合的引号补上，或者如果你确认这条命令是安全的，请自己在 `verify --run` 之外手动执行。',
    'safety.disk-write': '这条命令直接写裸磁盘设备，或覆盖系统鉴权文件（`mkfs`、`dd if=`，或者重定向写入 /dev/sd*、/dev/nvme*、/dev/disk*、/etc/passwd、/etc/shadow、/etc/sudoers），足以毁掉整台机器上的所有文件，或者把所有账号都锁在门外。这是硬规则：`--allow` 无法覆盖。如果你确认这条命令安全，请自己在 `verify --run` 之外手动执行。',
    'safety.power': '这条命令会关机、重启或挂起整台机器，跑着 `verify --run` 的这个进程和同一台机器上的其他东西会一起被带走。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.git-push': '这条命令会推送到远程仓库，可能移动或覆盖别人正依赖的分支。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.git-destructive': '这条命令会永久丢弃本地提交或未跟踪文件（`git reset --hard`、`git clean -f...` 或 `git filter-branch`）——`clean` 删掉的东西连 reflog 都找不回来。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.container-prune': '这条命令会批量删除 Docker 容器、镜像或卷，只存在于某个卷里的数据会跟着一起没了。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.k8s-delete': '这条命令会删除一个正在运行的 Kubernetes 资源，可能导致线上服务直接下线。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.iac-apply': '这条命令会应用或销毁真实的基础设施（`terraform apply`/`destroy`、`helm upgrade`/`delete`/`uninstall`），改动或拆掉的是别人正在用的系统。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.publish': '这条命令会把包或发行版发布到公共仓库——一旦有人装上了，你就没法把它撤回来。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.pipe-to-shell': '这条命令把远程下载的内容直接接进 shell 执行——这一刻那个 URL 吐出来的是什么，就原样跑什么，你根本没机会先看一眼。如果你确认这条命令该跑，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.shell-indirection': '这条命令把一整条新命令当成单个参数交给了 shell（`sh -c`、`bash -lc`、`eval` 等等），里面到底是什么，这里的任何规则都看不进去——不是这个模块判断内容安全，而是它压根没去看。如果你已经亲自看过这个参数、确认它安全，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.unresolved-binary': '这条命令要运行的程序名来自 shell 展开（`$(...)`、反引号替换，或者 `$VAR`/`${VAR}` 变量引用），不是写死的名字，这个模块没法知道实际会跑什么——跟拦截 shell 间接执行是同一个道理：看不见的东西不去猜，不代表结果就一定危险。等你确认了这个展开实际会解析成什么、确认安全之后，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.deploy-words': '这条规则是故意写宽的：只要命令里出现"deploy"、"prod"、"production"或"release"这几个词就会触发，哪怕只是脚本名叫 `release.sh` 这种无害的误伤也一样。这是有意为之——漏掉一次真正的部署，比多按一次确认的代价大得多。等你确认这条命令确实安全，用 `--allow` 加一条只匹配它的正则放行。',
    'safety.empty': '命令字符串是空的或者只有空白，根本没有东西可执行——这说明声明本身写错了或者漏了，不是一条真正的命令。去修正生成这个空字符串的地方；这里没有危险模式，`--allow` 也没有什么可放行的。',

    // --- verify.mjs（task 18）：CLI 报告文案 ---
    'verify.title': '验证报告',
    'verify.mode.dryRun': '模式：dry-run —— 下面列出的命令都还没有真正执行过。',
    'verify.mode.run': '模式：run —— 下面列出的命令已经真实执行过。',
    'verify.result.passed': '结果：通过',
    'verify.result.failed': '结果：未通过',
    'verify.commands.heading': '命令清单',
    'verify.col.role': '角色',
    'verify.col.command': '命令',
    'verify.col.status': '状态',
    'verify.status.planned': '计划执行（dry-run，尚未运行）',
    'verify.status.blocked': '已阻断（执行前被拒绝）',
    'verify.status.passed': '通过',
    'verify.status.failed': '失败',
    'verify.status.timeout': '超时',
    'verify.blocked.heading': '被阻断的命令',
    // task-18-brief.md B3：checkCommand 的 overriddenBy 告诉调用方"这条命令
    // 本来会被规则 X 拦下，是你用 --allow 显式放行的"——这正是 Task 16 把这个
    // 字段带出来的意义所在。这个标题和下面的警告文案，是为了让这条信息在人类
    // 可读报告里显眼地出现，而不是混在一堆正常通过里的一条脚注。
    'verify.overridden.heading': '你亲手放行的危险命令',
    'verify.overridden.warning': '`{role}`（`{command}`）本来会被 `{rule}` 规则拦下——你用 --allow 显式放行了它，这是你知情后自愿承担的风险。',
    'verify.noCommands.note': '这个仓库没有声明任何验证命令。这不等于"已验证"——只是压根没有东西可以失败。请在 harness.config.json 的 verify 字段里补上命令，再重新跑一遍。',
    'verify.runHint': '这是一次 dry-run —— 上面列出的命令都还没有真正执行过。加上 --run 才会真的执行这些命令。',
    'verify.reportWritten': '证据已写入 {path}',

    // --- gap 目录：loop ---
    'gap.loop.none.title': '未定义 agent 循环模式',
    'gap.loop.none.why': '没有定义循环模式时，agent 会话就是走一步看一步——工作怎么提出、怎么检查、怎么重复循环，完全没有结构。',
    'gap.loop.none.fix': '采用一种文档化的循环模式（goal loop、timer loop 或 maker-checker loop），匹配项目希望 agent 工作的方式。',
    'gap.loop.no-entrypoint.title': '循环写在文档里，但没有任何东西真的跑它',
    'gap.loop.no-entrypoint.why': '文档里描述了循环，但仓库里没有任何东西说明它从哪里开始——没有定时执行的 workflow，没有 loop/ 下的文档，harness.config.json 里也没有 loop 字段。想跑它的人只能从文字里自己还原一遍，而读到文档的人会理所当然地以为已经有东西在跑了。',
    'gap.loop.no-entrypoint.fix': '给这个循环一个入口。这项检查接受的三种信号里，只有一种真的会执行东西——定时触发的 CI workflow。另外两种（`loop/` 目录下的分模式文档、harness.config.json 里的 loop 字段）只是把循环定义在哪里记下来，让人或 agent 能找到它、把它跑起来，它们本身不会替你跑。',
    'gap.loop.no-stop-condition.title': '循环缺少停止条件',
    'gap.loop.no-stop-condition.why': '没有明确的停止条件时，agent 循环要么无限跑下去浪费预算，要么在目标还没达成时就随意停了。',
    'gap.loop.no-stop-condition.fix': '明确并写下结束循环的具体条件——通过标准、目标状态，或明确的终止信号。',
    'gap.loop.no-budget-cap.title': '循环缺少预算上限',
    'gap.loop.no-budget-cap.why': '没有预算上限时，一个卡住或跑偏的循环可能在无人察觉的情况下无限消耗时间或金钱。',
    'gap.loop.no-budget-cap.fix': '为每个循环设定并强制执行迭代次数、墙钟时间或花费的硬上限。',
    'gap.loop.no-maker-checker.title': '缺少 maker-checker 分离',
    'gap.loop.no-maker-checker.why': '同一个 agent 既做改动又给自己打分时，自利性判断和盲区都会畅通无阻地漏过去。',
    'gap.loop.no-maker-checker.fix': '把循环拆成 maker 和独立的 checker 两步，双方都对照同一份评分标准（rubric）来判断。',
    'gap.loop.no-rollback.title': '缺少回滚机制',
    'gap.loop.no-rollback.why': '没有回滚机制时，一次糟糕的循环迭代会永久性地污染状态，之后每一轮迭代都是在这个基础上继续叠加。',
    'gap.loop.no-rollback.fix': '加一个回滚机制（例如 git revert 或快照还原），供循环在某次迭代没通过检查时调用。',

    // --- scaffold.mjs（task 20）：CLI 报告文案 ---
    'scaffold.title': 'Harness 脚手架',
    'scaffold.mode.dryRun': '模式：dry-run —— 下面列出的内容都还没有真正写入。加上 --apply 才会真的写入。',
    'scaffold.mode.apply': '模式：apply —— 下面列出的文件已经真实写入。',
    'scaffold.noGaps': '没有可脚手架的内容 —— 这个仓库里每个可脚手架的差距都已经有对应文件了（或者 --only 选中的差距没有可脚手架的模板）。',
    'scaffold.planHeading': '计划写入的文件',
    'scaffold.col.action': '动作',
    'scaffold.col.target': '目标路径',
    'scaffold.col.gap': '差距',
    'scaffold.action.create': '新建（原来不存在）',
    'scaffold.action.propose': '提案（原文件保持不变）',
    'scaffold.applyHint': '这是一次 dry-run —— 上面列出的内容都还没有真正写入。加上 --apply 才会真的写入这些文件。',
    'scaffold.failure': '写入 {target} 失败：{message}',
    'scaffold.writtenSoFar': '失败前已经真实写入磁盘的文件（不会回滚）：{list}',
  },
};

/** Look up a localized message and interpolate {var} placeholders. */
export function t(key, lang, vars = {}) {
  const table = MESSAGES[lang];
  if (!table) throw new Error(`Unsupported language: ${lang}`);
  const raw = table[key];
  if (raw === undefined) throw new Error(`Missing i18n key: ${key}`);
  return raw.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

export function assertLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) {
    throw new CliError(`Unsupported language: ${lang}. Use one of: ${SUPPORTED_LANGS.join(', ')}`);
  }
  return lang;
}
