#!/usr/bin/env sh
# Copy the harness-engineering skills/ into every AI-agent ecosystem
# directory already present in the current project (.claude/skills,
# .cursor/skills, .codex/skills, .gemini/skills, .agent/skills); if none of
# those exist yet, default to creating .claude/skills.
#
# This copies skill TEXT only -- it never copies scripts/. What it does do is
# substitute this checkout's absolute path for ${CLAUDE_PLUGIN_ROOT} in the
# installed SKILL.md files, so their documented `node ".../scripts/*.mjs"`
# commands resolve immediately instead of asking the user for a path.
#
# The consequence, stated plainly: the installed skills are bound to THIS
# checkout's location. Move or delete it and they break. For a relocatable
# install, use the Claude Code plugin (.claude-plugin/marketplace.json in
# this repo). This script exists for ecosystems that have no plugin
# mechanism at all.
set -eu

SRC="${HARNESS_SRC:-$(cd "$(dirname "$0")" && pwd)}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

TARGETS=""
for d in .claude/skills .cursor/skills .codex/skills .gemini/skills .agent/skills; do
  [ -d "$d" ] && TARGETS="$TARGETS $d"
done
[ -z "$TARGETS" ] && TARGETS=".claude/skills"

# sed's replacement text gives & and \ special meaning, and | is the
# delimiter chosen below (a path can contain neither | nor a newline in
# practice, but & is entirely possible). Escape all three once, up front.
ESC_SRC=$(printf '%s' "$SRC" | sed 's/[&|\\]/\\&/g')

for t in $TARGETS; do
  echo "-> $t"
  [ "$DRY_RUN" = "1" ] && continue
  mkdir -p "$t"
  cp -R "$SRC"/skills/. "$t"/
  # Substitute this checkout's absolute path for ${CLAUDE_PLUGIN_ROOT} in the
  # INSTALLED copy only (never in "$SRC"/skills, which keeps the placeholder
  # form for the real plugin install path). None of the five target
  # ecosystems set a $CLAUDE_PLUGIN_ROOT-equivalent variable, so without this
  # the installed skills' documented commands cannot resolve.
  #
  # Enumerate the skill directory NAMES from "$SRC"/skills/ and only touch
  # "$t/<that name>/SKILL.md" -- do NOT glob "$t"/*/SKILL.md. ${CLAUDE_PLUGIN_ROOT}
  # is a general Claude Code convention, not proprietary to this repo, so a
  # destination-glob would also rewrite any unrelated third-party skill that
  # happens to already live in the same target directory (e.g. .claude/skills),
  # silently pointing its commands at THIS checkout's path. Scoping to exactly
  # the directories this script just copied keeps every other file in the
  # target directory byte-identical, no exceptions.
  #
  # `sed > tmp && mv` rather than `sed -i`: -i needs a suffix argument on BSD
  # sed and rejects one attached differently on some GNU builds, and this
  # script is tested under dash for POSIX compliance.
  for skill_dir in "$SRC"/skills/*/; do
    skill=${skill_dir%/}
    skill=${skill##*/}
    f="$t/$skill/SKILL.md"
    [ -f "$f" ] || continue
    sed "s|\${CLAUDE_PLUGIN_ROOT}|$ESC_SRC|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
done

if [ "$DRY_RUN" = "1" ]; then
  echo "dry run: nothing written"
else
  echo "installed harness-engineering skills"
  echo "Commands in the installed skills point at this checkout:"
  echo "  $SRC"
  echo "Move or delete that directory and the installed skills stop working."
  echo "(scripts/ itself is never copied -- only skill text, with this"
  echo "checkout's path substituted in.)"
  echo "For a relocatable install, use the Claude Code plugin instead:"
  echo "  https://github.com/huhenry/harness-engineering"
fi
