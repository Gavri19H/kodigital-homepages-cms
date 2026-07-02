#!/usr/bin/env bash
# Phase2.AC (BEHAVIORAL): the listicles vitest suites pass — unit (ids,
# macros, validation, rules) + integration (offers/sections/articles CRUD,
# atomic batches, conflict guard, gating). NEEDS_RUNTIME (exit 2) without
# node_modules.
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
if npx vitest run test/listicles- >"$LOG" 2>&1; then
  SUMMARY=$(grep -E "Test Files|Tests " "$LOG" | tr -s ' ' | tr '\n' ';')
  echo "PASS [T03] vitest listicles suites green ($SUMMARY)"
  exit 0
fi
echo "FAIL [T03] vitest listicles suites failed — tail of log:"
tail -30 "$LOG"
exit 1
