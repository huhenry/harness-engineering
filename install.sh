#!/usr/bin/env sh
# Copy the harness-engineering skills/ into every AI-agent ecosystem
# directory already present in the current project (.claude/skills,
# .cursor/skills, .codex/skills, .gemini/skills, .agent/skills); if none of
# those exist yet, default to creating .claude/skills.
#
# Honest limitation (see .superpowers/sdd task-22 report, brief section B1):
# this only copies skill TEXT. It never copies scripts/, and none of the
# five target ecosystems get a $CLAUDE_PLUGIN_ROOT-equivalent variable set
# for a script-relative-path scheme to anchor on -- so the harness-* skills'
# documented `node "$CLAUDE_PLUGIN_ROOT/scripts/*.mjs"` commands cannot
# resolve after this script runs, for ANY of the five targets, including
# .claude/skills (a plain skills-directory drop-in is not the same thing as
# a Claude Code plugin install, and does not get CLAUDE_PLUGIN_ROOT set
# either). For working commands out of the box, install this as a real
# Claude Code plugin instead (`.claude-plugin/marketplace.json` in this
# repo). This script exists for ecosystems that have no plugin mechanism at
# all, where shipping the skill's guidance text is still better than nothing.
set -eu

SRC="${HARNESS_SRC:-$(cd "$(dirname "$0")" && pwd)}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

TARGETS=""
for d in .claude/skills .cursor/skills .codex/skills .gemini/skills .agent/skills; do
  [ -d "$d" ] && TARGETS="$TARGETS $d"
done
[ -z "$TARGETS" ] && TARGETS=".claude/skills"

for t in $TARGETS; do
  echo "-> $t"
  [ "$DRY_RUN" = "1" ] && continue
  mkdir -p "$t"
  cp -R "$SRC"/skills/. "$t"/
done

if [ "$DRY_RUN" = "1" ]; then
  echo "dry run: nothing written"
else
  echo "installed harness-engineering skills"
  echo "NOTE: this installs skill text only. scripts/ was NOT copied, and none"
  echo "of these target directories give the harness-* skills a working path"
  echo "to it (no \$CLAUDE_PLUGIN_ROOT-equivalent variable is set here)."
  echo "The installed skills will ask you for a harness-engineering checkout"
  echo "path the first time a command actually needs to run. For working"
  echo "commands out of the box, install this as a Claude Code plugin instead:"
  echo "  https://github.com/huhenry/harness-engineering"
fi
