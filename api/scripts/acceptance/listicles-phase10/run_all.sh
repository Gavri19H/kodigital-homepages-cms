#!/usr/bin/env bash
# Runs every listicles-phase10 acceptance script.
# Exit 0 = all PASS (NEEDS_RUNTIME counts as pass-with-info), 1 = any FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOTAL=0; PASSED=0; RUNTIME=0; FAILED=0
for t in "$SCRIPT_DIR"/T*.sh; do
  TOTAL=$((TOTAL + 1))
  bash "$t"
  rc=$?
  name="$(basename "$t")"
  if [ "$rc" -eq 0 ]; then
    PASSED=$((PASSED + 1))
  elif [ "$rc" -eq 2 ]; then
    RUNTIME=$((RUNTIME + 1))
    echo "NEEDS_RUNTIME [$name]"
  else
    FAILED=$((FAILED + 1))
    echo "FAILED [$name]"
  fi
done

echo "----------------------------------------"
echo "listicles-phase10: $PASSED/$TOTAL pass, $RUNTIME needs-runtime, $FAILED failed"
[ "$FAILED" -eq 0 ] || exit 1
exit 0
