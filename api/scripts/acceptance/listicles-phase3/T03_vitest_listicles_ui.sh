#!/usr/bin/env bash
# Phase3.AC (BEHAVIORAL): the listicles UI vitest suites pass — shell routes
# (302 + three 200 tabs + anatomy), §9 columns/modal/32-chip assertions over
# the REAL admin router + REAL migrations (node:sqlite), and the §25
# ES5-only inline-script gate (regex + node --check parse) for every new
# page. NEEDS_RUNTIME (exit 2) without node_modules.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

if ! command -v npx >/dev/null 2>&1 || [ ! -d "$REPO_ROOT/api/node_modules" ]; then
  echo "INFO [T03] vitest not run (NEEDS_RUNTIME: api/node_modules missing)"
  exit 2
fi

cd "$REPO_ROOT/api" || exit 1
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
if npx vitest run test/listicles-ui.test.ts test/listicles-ui-es5.test.ts >"$LOG" 2>&1; then
  SUMMARY=$(grep -E "Test Files|Tests " "$LOG" | tr -s ' ' | tr '\n' ';')
  echo "PASS [T03] listicles UI vitest suites green ($SUMMARY)"
  exit 0
fi
echo "FAIL [T03] listicles UI vitest suites failed — tail of log:"
tail -30 "$LOG"
exit 1
