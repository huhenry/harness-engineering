#!/usr/bin/env bash
set -euo pipefail

# harness-engineering ships zero runtime dependencies (Node stdlib only), so
# there is nothing to fetch from a registry -- package-lock.json exists
# purely to pin "zero dependencies" as a reproducible fact, the same way a
# lockfile with entries pins which ones. This script's real job is
# therefore not "npm install", it is proving the one thing a clean checkout
# actually needs before anything in AGENTS.md's Verification section can
# run: a Node runtime new enough (see package.json's `engines` field and
# .nvmrc), and a lockfile that still matches package.json exactly.

REQUIRED_MAJOR=20
ACTUAL_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"

if [ "$ACTUAL_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  echo "node >= ${REQUIRED_MAJOR} is required, found $(node -v)" >&2
  exit 1
fi

npm ci --ignore-scripts --no-audit --no-fund >/dev/null

echo "bootstrap ok: $(node -v), zero runtime dependencies, package-lock.json verified"
