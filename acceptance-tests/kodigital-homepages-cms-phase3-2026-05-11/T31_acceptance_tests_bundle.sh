#!/usr/bin/env bash
# T31.AC: bundle has >=30 *.sh files, each with >=1 check() call; run_all.sh exists.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T31] $desc"; else echo "FAIL [T31] $desc"; FAIL=1; fi
}
check "run_all.sh exists" test -f "$SCRIPT_DIR/run_all.sh"
COUNT=$(find "$SCRIPT_DIR" -maxdepth 1 -name '*.sh' | wc -l | tr -d ' ')
check "at least 30 .sh files in bundle (got $COUNT)" test "$COUNT" -ge 30
# Every per-story script must contain at least one literal `check ` call.
MISSING=0
for sh in "$SCRIPT_DIR"/T*.sh; do
  [ -f "$sh" ] || continue
  if ! grep -qE '^[[:space:]]*check ' "$sh"; then
    echo "FAIL [T31] $sh has no check() invocation"
    MISSING=1
  fi
done
check "every T*.sh has at least one check() call" test "$MISSING" -eq 0
[ "$FAIL" -eq 0 ] || exit 1
exit 0
