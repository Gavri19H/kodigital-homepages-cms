#!/usr/bin/env bash
# Phase 3 acceptance-tests aggregator.
# Exit codes:
#   0 — all scripts PASS or skipped with NEEDS_RUNTIME(2)
#   1 — at least one HARD FAIL
#   2 — never returned (NEEDS_RUNTIME is per-script only)
#
# AC2 contract: run_all.sh exits 0 in dev-server-available environments,
# and tolerates exit 2 (NEEDS_RUNTIME) only for behavioral tests that
# require `wrangler dev`.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0
FAILED_SCRIPTS=()

for script in "$SCRIPT_DIR"/T*.sh; do
  [ -f "$script" ] || continue
  name="$(basename "$script")"
  bash "$script"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    PASS_COUNT=$((PASS_COUNT+1))
  elif [ "$rc" -eq 2 ]; then
    SKIP_COUNT=$((SKIP_COUNT+1))
    echo "SKIP[NEEDS_RUNTIME]: $name"
  else
    FAIL_COUNT=$((FAIL_COUNT+1))
    FAILED_SCRIPTS+=("$name (rc=$rc)")
  fi
done

echo "---"
echo "PASS=$PASS_COUNT SKIP=$SKIP_COUNT FAIL=$FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  for f in "${FAILED_SCRIPTS[@]}"; do
    echo "FAIL: $f"
  done
  exit 1
fi
exit 0
