#!/usr/bin/env bash
# T9.AC: seed inserts >=7 categories and category_verticals mapping rows.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T9] $desc"; else echo "FAIL [T9] $desc"; FAIL=1; fi
}
MIG="$REPO_ROOT/api/migrations/0004_phase3_seed_verticals_and_legal_templates.sql"
check "seed migration exists" test -f "$MIG"
CAT_COUNT=$(grep -cE "INSERT (OR IGNORE )?INTO categories " "$MIG" || true)
check "categories seeds >=7 (got $CAT_COUNT)" test "$CAT_COUNT" -ge 7
CV_COUNT=$(grep -cE "INSERT (OR IGNORE )?INTO category_verticals " "$MIG" || true)
check "category_verticals rows >=1 (got $CV_COUNT)" test "$CV_COUNT" -ge 1
[ "$FAIL" -eq 0 ] || exit 1
exit 0
